import IORedis from "ioredis";

/**
 * Cache genérico best-effort (fail-open) pra endpoints de leitura quente.
 * Reusa o REDIS_URL já provisionado (Upstash), mas conexão própria — não
 * compartilha com a fila de embeddings (services/knowledge/redis-connection.ts),
 * que exige conexões dedicadas por causa do BullMQ.
 * Redis fora do ar/não configurado nunca deve derrubar o endpoint: get/set
 * engolem erro e caem pra "cache miss".
 */
let client: IORedis | null | undefined;

function getClient(): IORedis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    client = null;
    return client;
  }
  client = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
  client.on("error", (err) => console.error("[app-cache] redis error:", err.message));
  return client;
}

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const raw = await c.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.error("[app-cache] get failed:", (err as Error).message);
    return null;
  }
}

export async function cacheSetJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error("[app-cache] set failed:", (err as Error).message);
  }
}
