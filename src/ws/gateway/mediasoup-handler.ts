import * as mediasoup from "mediasoup";
import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "../auth/authenticate";
import { MediasoupManager } from "../mediasoup/mediasoup-manager";
import { transcriptionPipeline } from "../../services/transcription/transcription-pipeline";
import { callSessionService } from "../../services/call/call-session.service";
import { meetingSummaryService } from "../../services/meeting-summary/meeting-summary.service";

// Mapas para gerenciar o estado em memória (vincular ao Socket ID)
const transports = new Map<
  string,
  Map<string, mediasoup.types.WebRtcTransport>
>(); // socketId -> transportId -> Transport
const producers = new Map<string, Map<string, mediasoup.types.Producer>>(); // socketId -> producerId -> Producer
const consumers = new Map<string, Map<string, mediasoup.types.Consumer>>(); // socketId -> consumerId -> Consumer

// Grace period antes de fechar a CallSession quando a sala cai pra <2
// pessoas com áudio — evita cortar a reunião por um blip curto (queda de
// rede, reconexão, mutar por engano). Se alguém volta a 2+ antes de expirar,
// o timer é cancelado e a call segue de onde parou; nada é tocado até então.
const CALL_END_GRACE_MS = 60_000;
const roomEndGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Usuários com producer de áudio (mic, não screen-share) ativo numa sala —
// é a contagem que decide se a transcrição deve rodar (só com 2+ pessoas).
function getRoomAudioProducerUserIds(
  io: SocketIOServer,
  roomId: string
): Set<string> {
  const userIds = new Set<string>();
  producers.forEach((socketProducers, socketId) => {
    socketProducers.forEach((producer) => {
      if (
        producer.kind === "audio" &&
        producer.appData?.source !== "screen" &&
        producer.appData?.roomId === roomId
      ) {
        const userId = (io.sockets.sockets.get(socketId) as any)?.user?.id;
        if (userId) userIds.add(userId);
      }
    });
  });
  return userIds;
}

// Encerra de fato a call: desanexa os pipelines de áudio que sobraram na
// sala e, se não houver mais nenhum ativo, fecha a CallSession e dispara o
// pipeline de resumo. Só roda depois que o grace period expira sem ninguém
// ter voltado.
async function finalizeRoomAfterGrace(io: SocketIOServer, roomId: string) {
  roomEndGraceTimers.delete(roomId);

  // Reavalia — pode ter voltado gente entre o timer disparar e aqui rodar.
  if (getRoomAudioProducerUserIds(io, roomId).size >= 2) return;

  for (const socketProducers of producers.values()) {
    for (const producer of socketProducers.values()) {
      if (
        producer.kind !== "audio" ||
        producer.appData?.source === "screen" ||
        producer.appData?.roomId !== roomId
      ) {
        continue;
      }
      await transcriptionPipeline.detachFromProducer(producer.id);
    }
  }

  if (!transcriptionPipeline.hasActivePipelineForRoom(roomId)) {
    const closedSessionIds = await callSessionService.endActive(roomId);
    for (const callSessionId of closedSessionIds) {
      meetingSummaryService
        .enqueueForCallSession(callSessionId)
        .catch((err) =>
          console.error("Erro ao enfileirar resumo da reunião:", err)
        );
    }
  }
}

// Reavalia a transcrição de uma sala inteira: anexa todo mundo se há 2+
// pessoas com áudio ativo. Se sobrou só 1 (ou 0), NÃO desanexa/encerra na
// hora — agenda o grace period (CALL_END_GRACE_MS); se a sala voltar a ter
// 2+ antes de expirar, o timer é cancelado e nada é tocado.
// Idempotente — attachToProducer já é no-op se repetido.
async function syncTranscriptionForRoom(io: SocketIOServer, roomId: string) {
  const shouldTranscribe = getRoomAudioProducerUserIds(io, roomId).size >= 2;

  if (shouldTranscribe) {
    const pendingTimer = roomEndGraceTimers.get(roomId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      roomEndGraceTimers.delete(roomId);
    }

    const manager = await MediasoupManager.getInstance();
    for (const [socketId, socketProducers] of producers) {
      for (const producer of socketProducers.values()) {
        if (
          producer.kind !== "audio" ||
          producer.appData?.source === "screen" ||
          producer.appData?.roomId !== roomId
        ) {
          continue;
        }
        const userId = (io.sockets.sockets.get(socketId) as any)?.user?.id;
        if (!userId) continue;
        const router = await manager.getOrCreateRouter(roomId);
        transcriptionPipeline
          .attachToProducer({ io, roomId, userId, producer, router })
          .catch((err) =>
            console.error("Erro ao anexar pipeline de transcrição:", err)
          );
      }
    }
    return;
  }

  if (roomEndGraceTimers.has(roomId)) return;

  const timer = setTimeout(() => {
    void finalizeRoomAfterGrace(io, roomId);
  }, CALL_END_GRACE_MS);
  roomEndGraceTimers.set(roomId, timer);
}

export const handleMediasoupEvents = async (
  io: SocketIOServer,
  socket: AuthenticatedSocket
) => {
  const manager = await MediasoupManager.getInstance();

  // 1. Obter capacidades do roteador da sala
  socket.on(
    "MEDIASOUP_GET_ROUTER_CAPABILITIES",
    async (data: { roomId: string }, callback) => {
      try {
        const router = await manager.getOrCreateRouter(data.roomId);
        callback({ rtpCapabilities: router.rtpCapabilities });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 1.1 Obter Producers existentes na sala
  socket.on("MEDIASOUP_GET_PRODUCERS", (data: { roomId: string }, callback) => {
    const roomProducers: any[] = [];

    producers.forEach((socketProducers) => {
      socketProducers.forEach((producer) => {
        // Ignorar producers do próprio usuário — inclusive um "fantasma"
        // deixado por uma reconexão recente (socket antigo ainda não
        // limpo), que não seria pego só comparando socket.id.
        if (producer.appData.userId === socket.user?.id) return;

        if (producer.appData.roomId === data.roomId) {
          roomProducers.push({
            producerId: producer.id,
            userId: producer.appData.userId,
            kind: producer.kind,
            appData: producer.appData,
          });
        }
      });
    });

    callback({ producers: roomProducers });
  });

  // 2. Criar WebRtcTransport
  socket.on(
    "MEDIASOUP_CREATE_TRANSPORT",
    async (data: { roomId: string; direction: "send" | "recv" }, callback) => {
      try {
        const router = await manager.getOrCreateRouter(data.roomId);
        const transport = await manager.createWebRtcTransport(router);

        // Armazenar transporte
        if (!transports.has(socket.id)) transports.set(socket.id, new Map());
        transports.get(socket.id)!.set(transport.id, transport);

        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
          sctpParameters: transport.sctpParameters,
        });

        transport.on("dtlsstatechange", (dtlsState: string) => {
          if (dtlsState === "closed") transport.close();
        });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 3. Conectar Transport
  socket.on(
    "MEDIASOUP_CONNECT_TRANSPORT",
    async (data: { transportId: string; dtlsParameters: any }, callback) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        await transport.connect({ dtlsParameters: data.dtlsParameters });
        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 4. Produzir Mídia
  socket.on(
    "MEDIASOUP_PRODUCE",
    async (
      data: {
        transportId: string;
        kind: "audio" | "video";
        rtpParameters: any;
        appData?: any;
      },
      callback
    ) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        const producer = await transport.produce({
          kind: data.kind,
          rtpParameters: data.rtpParameters,
          // userId gravado no appData (não só derivado do socket.id) pra
          // sobreviver a reconexões: se o socket antigo cair e um novo
          // socket do mesmo usuário pedir GET_PRODUCERS antes da limpeza
          // do disconnect terminar, ainda dá pra identificar e excluir
          // esse producer "fantasma" como sendo do próprio usuário.
          appData: { ...data.appData, userId: socket.user?.id },
        });

        if (!producers.has(socket.id)) producers.set(socket.id, new Map());
        producers.get(socket.id)!.set(producer.id, producer);

        // Fallback: se o cliente fechar o transport sem MEDIASOUP_CLOSE_PRODUCER,
        // ainda assim derruba a pipeline de transcrição.
        producer.on("transportclose", () => {
          producers.get(socket.id)?.delete(producer.id);
          const closedRoomId = producer.appData?.roomId;
          void transcriptionPipeline
            .detachFromProducer(producer.id)
            .then(async () => {
              if (typeof closedRoomId === "string") {
                await syncTranscriptionForRoom(io, closedRoomId);
              }
            })
            .catch((err) =>
              console.error(
                "Erro ao encerrar transcrição após transportclose:",
                err
              )
            );
        });

        callback({ id: producer.id });

        // Notificar outros na sala sobre o novo producer
        const roomId = (transport as any)._data?.roomId || data.appData?.roomId;
        if (roomId) {
          socket.to(roomId).emit("NEW_PRODUCER", {
            producerId: producer.id,
            userId: socket.user?.id,
            kind: producer.kind,
            appData: producer.appData,
          });

          // Áudio de microfone (não screen-share) alimenta o pipeline de
          // transcrição — só roda com 2+ pessoas com áudio ativo na sala.
          if (
            producer.kind === "audio" &&
            producer.appData?.source !== "screen" &&
            socket.user
          ) {
            void syncTranscriptionForRoom(io, roomId as string).catch((err) =>
              console.error("Erro ao sincronizar pipeline de transcrição:", err)
            );
          }
        }
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 5. Consumir Mídia
  socket.on(
    "MEDIASOUP_CONSUME",
    async (
      data: { transportId: string; producerId: string; rtpCapabilities: any },
      callback
    ) => {
      try {
        const transport = transports.get(socket.id)?.get(data.transportId);
        if (!transport) throw new Error("Transport not found");

        // Encontrar o producer em todos os sockets (SFU)
        let targetProducer: mediasoup.types.Producer | undefined;
        for (const socketProducers of producers.values()) {
          if (socketProducers.has(data.producerId)) {
            targetProducer = socketProducers.get(data.producerId);
            break;
          }
        }

        if (!targetProducer) throw new Error("Producer not found");

        const roomId = targetProducer.appData.roomId;
        if (!roomId)
          throw new Error("Producer has no roomId provided in appData");

        const router = await manager.getOrCreateRouter(roomId as string);

        if (
          !router.canConsume({
            producerId: data.producerId,
            rtpCapabilities: data.rtpCapabilities,
          })
        ) {
          throw new Error("Cannot consume");
        }

        const consumer = await transport.consume({
          producerId: data.producerId,
          rtpCapabilities: data.rtpCapabilities,
          paused: true, // Começar pausado para evitar race conditions
        });

        if (!consumers.has(socket.id)) consumers.set(socket.id, new Map());
        consumers.get(socket.id)!.set(consumer.id, consumer);

        callback({
          id: consumer.id,
          producerId: data.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 6. Resumir Consumer
  socket.on(
    "MEDIASOUP_RESUME_CONSUMER",
    async (data: { consumerId: string }, callback) => {
      try {
        const consumer = consumers.get(socket.id)?.get(data.consumerId);
        if (!consumer) throw new Error("Consumer not found");

        await consumer.resume();
        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 7. Pausar Producer
  socket.on(
    "MEDIASOUP_PAUSE_PRODUCER",
    async (data: { producerId: string }, callback) => {
      try {
        const producer = producers.get(socket.id)?.get(data.producerId);
        if (!producer) throw new Error("Producer not found");

        await producer.pause();
        
        // Notificar outros na sala
        const roomId = producer.appData?.roomId;
        if (roomId && typeof roomId === "string") {
          socket.to(roomId).emit("PRODUCER_PAUSED", {
            producerId: producer.id,
            userId: socket.user?.id,
          });
        }

        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 8. Retomar Producer
  socket.on(
    "MEDIASOUP_RESUME_PRODUCER",
    async (data: { producerId: string }, callback) => {
      try {
        const producer = producers.get(socket.id)?.get(data.producerId);
        if (!producer) throw new Error("Producer not found");

        await producer.resume();
        
        // Notificar outros na sala
        const roomId = producer.appData?.roomId;
        if (roomId && typeof roomId === "string") {
          socket.to(roomId).emit("PRODUCER_RESUMED", {
            producerId: producer.id,
            userId: socket.user?.id,
            kind: producer.kind,
            appData: producer.appData,
          });
        }

        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // 9. Fechar Producer
  socket.on(
    "MEDIASOUP_CLOSE_PRODUCER",
    async (data: { producerId: string }, callback) => {
      try {
        const producer = producers.get(socket.id)?.get(data.producerId);
        if (!producer) throw new Error("Producer not found");

        const roomId = producer.appData?.roomId;
        const source = producer.appData?.source;

        // Fechar o producer
        producer.close();
        producers.get(socket.id)?.delete(data.producerId);

        // Notificar outros na sala
        if (roomId && typeof roomId === "string") {
          socket.to(roomId).emit("PRODUCER_CLOSED", {
            producerId: producer.id,
            userId: socket.user?.id,
            source: source,
          });

          await transcriptionPipeline.detachFromProducer(producer.id);
          await syncTranscriptionForRoom(io, roomId);
        }

        callback({ success: true });
      } catch (error: any) {
        callback({ error: error.message });
      }
    }
  );

  // Cleanup on disconnect
  socket.on("disconnect", async () => {
    const userTransports = transports.get(socket.id);
    const userProducers = producers.get(socket.id);

    // Notificar outros na sala sobre os producers fechados
    if (userProducers && socket.user) {
      const affectedRoomIds = new Set<string>();

      for (const producer of userProducers.values()) {
        const roomId = producer.appData?.roomId;
        const source = producer.appData?.source;
        if (roomId && typeof roomId === "string") {
          socket.to(roomId).emit("PRODUCER_CLOSED", {
            producerId: producer.id,
            userId: socket.user?.id,
            source: source,
          });

          await transcriptionPipeline.detachFromProducer(producer.id);
          affectedRoomIds.add(roomId);
        }
      }

      // Remove os producers deste socket ANTES de resincronizar — senão a
      // contagem de usuários com áudio ativo ainda inclui quem tá saindo.
      producers.delete(socket.id);

      for (const roomId of affectedRoomIds) {
        await syncTranscriptionForRoom(io, roomId);
      }
    } else {
      producers.delete(socket.id);
    }

    if (userTransports) {
      userTransports.forEach((t) => t.close());
      transports.delete(socket.id);
    }
    consumers.delete(socket.id);
  });
};
