import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingResult {
  vector: number[];
  model: string;
  tokenCount: number;
}

/**
 * Anthropic não oferece API de embeddings — usa-se OpenAI aqui mesmo quando
 * ANTHROPIC_API_KEY está definida para o resto do sistema (agentes/resumo).
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada — necessária para gerar embeddings");

  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const data = response.data[0];
  if (!data) throw new Error("Resposta de embedding vazia");

  return {
    vector: data.embedding,
    model: EMBEDDING_MODEL,
    tokenCount: response.usage?.total_tokens ?? 0,
  };
}
