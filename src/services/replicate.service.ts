import Replicate from "replicate";

export interface GenerateImageInput {
  prompt: string;
  referenceImageUrls?: string[];
}

export interface GenerateImageResult {
  outputUrls: string[];
  model: string;
  predictionId?: string;
}

function getClient(): Replicate {
  const auth = process.env.REPLICATE_API_TOKEN;
  if (!auth) throw new Error("REPLICATE_API_TOKEN não configurada");
  return new Replicate({ auth });
}

function toOutputUrls(output: unknown): string[] {
  const items = Array.isArray(output) ? output : [output];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      // Replicate JS SDK pode retornar um FileOutput (com .url()) em vez de string.
      if (item && typeof (item as any).url === "function") return String((item as any).url());
      return null;
    })
    .filter((url): url is string => Boolean(url));
}

/**
 * Roda o modelo de geração de imagem configurado (default: Nano Banana, aceita
 * múltiplas imagens de referência via `image_input`). `replicate.run` já espera
 * a prediction terminar antes de retornar — não precisa polling manual aqui,
 * o polling que existe é no job assíncrono (post-generation.service.ts) em
 * relação ao restante do pipeline (download + upload Cloudinary).
 */
export async function generateImage({ prompt, referenceImageUrls }: GenerateImageInput): Promise<GenerateImageResult> {
  const model = process.env.REPLICATE_IMAGE_MODEL || "google/nano-banana";
  const client = getClient();

  const input: Record<string, unknown> = { prompt };
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    input.image_input = referenceImageUrls;
  }

  const output = await client.run(model as `${string}/${string}`, { input });
  const outputUrls = toOutputUrls(output);
  if (outputUrls.length === 0) {
    throw new Error("Replicate não retornou nenhuma imagem de saída");
  }

  return { outputUrls, model };
}
