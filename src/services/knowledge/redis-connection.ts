import IORedis from "ioredis";

/**
 * Conexão Redis dedicada à pipeline de embeddings (BullMQ). Isolada do resto
 * do sistema — nenhuma outra fila hoje usa Redis (ver simple-queue.ts).
 * Cada chamada cria uma conexão nova (BullMQ recomenda não compartilhar
 * conexão entre Queue e Worker).
 */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL não configurada — necessária para a fila de embeddings (knowledge). Provisione um Redis (ex: Railway plugin) e defina REDIS_URL no .env."
    );
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}
