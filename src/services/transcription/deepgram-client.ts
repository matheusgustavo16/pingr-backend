import { DeepgramClient } from "@deepgram/sdk";

let client: DeepgramClient | null = null;

function getDeepgramClient(): DeepgramClient {
  if (!process.env.DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY não configurada");
  }
  if (!client) {
    client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
  }
  return client;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  confidence?: number;
}

/**
 * Abre uma conexão de streaming com o Deepgram (Listen v1) já configurada
 * para o formato que o ffmpeg do pipeline de transcrição produz: PCM16LE
 * mono 16kHz. Speaker ID não é responsabilidade do Deepgram aqui — cada
 * conexão já corresponde a um único participante (um producer de áudio).
 */
export async function openLiveTranscription(
  onTranscript: (event: TranscriptEvent) => void,
  onError: (error: Error) => void
) {
  const dg = getDeepgramClient();

  const connection = await dg.listen.v1.connect({
    model: "nova-2",
    language: "pt-BR",
    punctuate: "true",
    smart_format: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
  });

  connection.on("message", (data: any) => {
    if (data.type !== "Results" || !data.is_final) return;

    const alt = data.channel?.alternatives?.[0];
    if (!alt?.transcript?.trim()) return;

    const startMs = Math.round((data.start ?? 0) * 1000);
    const endMs = Math.round(((data.start ?? 0) + (data.duration ?? 0)) * 1000);

    onTranscript({
      text: alt.transcript,
      isFinal: true,
      startMs,
      endMs,
      confidence: alt.confidence,
    });
  });

  connection.on("error", (error: Error) => onError(error));

  connection.connect();
  await connection.waitForOpen();

  return connection;
}
