// Fila em memória, single-instance — mesma premissa já aceita no resto da
// camada mediasoup/transcrição (ver transcription-pipeline.ts). Processa um
// job por vez em ordem FIFO, sem bloquear quem chamou enqueue(). Isolado
// atrás de createQueue() para poder trocar por BullMQ/Redis depois sem mexer
// nos call sites.
type JobHandler<T> = (payload: T) => Promise<void>;

export function createQueue<T>(name: string, handler: JobHandler<T>) {
  const pending: T[] = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.length > 0) {
        const job = pending.shift()!;
        try {
          await handler(job);
        } catch (err) {
          console.error(`[queue:${name}] job falhou:`, err);
        }
      }
    } finally {
      running = false;
    }
  }

  function enqueue(payload: T) {
    pending.push(payload);
    void drain();
  }

  return { enqueue };
}
