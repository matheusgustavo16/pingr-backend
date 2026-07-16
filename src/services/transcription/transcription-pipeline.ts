import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type * as mediasoup from "mediasoup";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../prisma.service";
import { callSessionService } from "../call/call-session.service";
import { openLiveTranscription } from "./deepgram-client";

interface AttachParams {
  io: SocketIOServer;
  roomId: string;
  userId: string;
  producer: mediasoup.types.Producer;
  router: mediasoup.types.Router;
}

interface PipelineEntry {
  roomId: string;
  plainTransport: mediasoup.types.PlainTransport;
  consumer: mediasoup.types.Consumer;
  ffmpeg: ChildProcessWithoutNullStreams;
  deepgramConnection: Awaited<ReturnType<typeof openLiveTranscription>>;
  sdpPath: string;
  markShuttingDown: () => void;
}

// producerId -> pipeline. Estado em memória, mesma premissa do resto da
// camada mediasoup (single instância — ver débito técnico no plano).
const pipelines = new Map<string, PipelineEntry>();

// Faixa de portas dedicada ao RTP que o ffmpeg escuta, separada da faixa
// rtcMinPort/rtcMaxPort (10000-10100) usada pelos workers do mediasoup.
let nextRtpPort = 20000;
function allocatePort(): number {
  const port = nextRtpPort;
  nextRtpPort += 2; // deixa a porta ímpar seguinte livre para RTCP
  if (nextRtpPort > 20200) nextRtpPort = 20000;
  return port;
}

function buildSdp(
  codec: mediasoup.types.RtpCodecParameters,
  rtpPort: number,
  rtcpPort: number
): string {
  const encodingName = codec.mimeType.split("/")[1]?.toUpperCase() ?? "OPUS";
  const channels = codec.channels ?? 1;
  // FFmpeg não suporta rtcp-mux — RTP e RTCP em portas separadas (rtcp = rtp+1).
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=pingr-transcription",
    "c=IN IP4 127.0.0.1",
    "t=0 0",
    `m=audio ${rtpPort} RTP/AVP ${codec.payloadType}`,
    `a=rtcp:${rtcpPort}`,
    `a=rtpmap:${codec.payloadType} ${encodingName}/${codec.clockRate}/${channels}`,
    "a=recvonly",
    "",
  ].join("\n");
}

async function attachToProducer({ io, roomId, userId, producer, router }: AttachParams) {
  if (producer.kind !== "audio") return;
  if (producer.appData?.source === "screen") return;
  if (pipelines.has(producer.id)) return;
  if (!process.env.DEEPGRAM_API_KEY) {
    console.warn(
      `⚠️ DEEPGRAM_API_KEY ausente — transcrição desabilitada (producer ${producer.id})`
    );
    return;
  }

  try {
    const callSessionId = await callSessionService.startOrGetActive(roomId, userId);

    const plainTransport = await router.createPlainTransport({
      listenIp: { ip: "127.0.0.1" },
      // FFmpeg não faz rtcp-mux; precisa de RTP e RTCP em portas distintas.
      rtcpMux: false,
      comedia: false,
    });

    const consumer = await plainTransport.consume({
      producerId: producer.id,
      rtpCapabilities: router.rtpCapabilities,
      paused: true,
    });

    const rtpPort = allocatePort();
    const rtcpPort = rtpPort + 1;
    await plainTransport.connect({
      ip: "127.0.0.1",
      port: rtpPort,
      rtcpPort,
    });

    const codec = consumer.rtpParameters.codecs[0];
    const sdp = buildSdp(codec, rtpPort, rtcpPort);
    const sdpPath = path.join(os.tmpdir(), `pingr-transcribe-${producer.id}.sdp`);
    fs.writeFileSync(sdpPath, sdp);

    const ffmpeg: ChildProcessWithoutNullStreams = spawn("ffmpeg", [
      "-protocol_whitelist",
      "file,udp,rtp",
      "-i",
      sdpPath,
      "-f",
      "s16le",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-loglevel",
      "error",
      "pipe:1",
    ]);

    // Demux errors no kill (ex.: -138) são esperados — não poluir o log.
    let shuttingDown = false;
    const markShuttingDown = () => {
      shuttingDown = true;
    };

    ffmpeg.stderr.on("data", (chunk) => {
      if (shuttingDown) return;
      console.error(`[transcription:ffmpeg:${producer.id}]`, chunk.toString());
    });
    ffmpeg.on("error", (err) => {
      if (shuttingDown) return;
      console.error(`[transcription:ffmpeg:${producer.id}] falhou ao iniciar`, err);
    });

    const deepgramConnection = await openLiveTranscription(
      async ({ text, isFinal, startMs, endMs, confidence }) => {
        if (!isFinal) return;

        const segment = await prisma.transcriptSegment.create({
          data: {
            callSessionId,
            roomId,
            userId,
            text,
            isFinal: true,
            startMs,
            endMs,
            confidence: confidence ?? null,
          },
        });

        io.to(roomId).emit("TRANSCRIPT_SEGMENT", {
          id: segment.id,
          callSessionId,
          roomId,
          userId,
          text,
          isFinal: true,
          startMs,
          endMs,
          confidence: confidence ?? null,
        });
      },
      (error) => {
        console.error(`[transcription:deepgram:${producer.id}]`, error.message);
      }
    );

    // `ffmpeg.kill()` é assíncrono — o stdout pode emitir mais alguns chunks
    // depois do detach chamar `deepgramConnection.close()`, e `sendMedia` num
    // socket já fechado lança síncrono (derruba o processo se não for pego
    // aqui). `shuttingDown` evita a chamada na maioria dos casos; o try/catch
    // cobre o resto (ex.: deepgram fechar a conexão sozinho por outro motivo).
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      if (shuttingDown) return;
      try {
        deepgramConnection.sendMedia(chunk);
      } catch (error) {
        if (!shuttingDown) {
          console.error(`[transcription:deepgram:${producer.id}] falha ao enviar áudio`, error);
        }
      }
    });

    await consumer.resume();

    pipelines.set(producer.id, {
      roomId,
      plainTransport,
      consumer,
      ffmpeg,
      deepgramConnection,
      sdpPath,
      markShuttingDown,
    });

    console.log(
      `🎙️ Transcrição iniciada — producer ${producer.id}, user ${userId}, room ${roomId}`
    );
  } catch (error) {
    console.error("Erro ao iniciar pipeline de transcrição:", error);
  }
}

async function detachFromProducer(producerId: string) {
  const entry = pipelines.get(producerId);
  if (!entry) return;
  pipelines.delete(producerId);

  entry.markShuttingDown();

  try {
    entry.deepgramConnection.close();
  } catch {
    // conexão já pode estar fechada
  }
  // Mata o ffmpeg antes de fechar o transport — evita demux error no stderr.
  try {
    if (!entry.ffmpeg.killed) {
      entry.ffmpeg.kill("SIGTERM");
    }
  } catch {
    // processo já pode ter saído
  }
  try {
    entry.consumer.close();
  } catch {
    // idem
  }
  try {
    entry.plainTransport.close();
  } catch {
    // idem
  }
  try {
    fs.unlinkSync(entry.sdpPath);
  } catch {
    // arquivo temporário já removido
  }

  console.log(`🛑 Transcrição encerrada — producer ${producerId}`);
}

function hasActivePipelineForRoom(roomId: string): boolean {
  for (const entry of pipelines.values()) {
    if (entry.roomId === roomId) return true;
  }
  return false;
}

async function detachAllForRoom(roomId: string) {
  const ids = Array.from(pipelines.entries())
    .filter(([, entry]) => entry.roomId === roomId)
    .map(([id]) => id);
  await Promise.all(ids.map((id) => detachFromProducer(id)));
}

export const transcriptionPipeline = {
  attachToProducer,
  detachFromProducer,
  detachAllForRoom,
  hasActivePipelineForRoom,
};
