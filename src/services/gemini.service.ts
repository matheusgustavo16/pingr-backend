import { GoogleGenAI } from "@google/genai";
import type { GenerateImageInput, GenerateImageResult } from "./replicate.service";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY não configurada");
  return new GoogleGenAI({ apiKey });
}

async function urlToInlineDataPart(url: string): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao baixar imagem de referência (${response.status}): ${url}`);
  const mimeType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { inlineData: { mimeType, data: buffer.toString("base64") } };
}

/**
 * Gera imagem via Gemini API (Nano Banana Pro / gemini-3-pro-image). Imagens de
 * referência viram parts inlineData na mesma mensagem — a API aceita até 14
 * imagens de referência por chamada.
 */
export async function generateImage({ prompt, referenceImageUrls }: GenerateImageInput): Promise<GenerateImageResult> {
  const model = process.env.GOOGLE_AI_IMAGE_MODEL || "gemini-3-pro-image";
  const client = getClient();

  const referenceParts = referenceImageUrls?.length
    ? await Promise.all(referenceImageUrls.map(urlToInlineDataPart))
    : [];

  const response = await client.models.generateContent({
    model,
    contents: [{ text: prompt }, ...referenceParts],
    config: { responseModalities: ["IMAGE"] },
  });

  const parts = response.candidates?.[0]?.content?.parts || [];
  const outputUrls = parts
    .filter((part): part is { inlineData: { mimeType: string; data: string } } => Boolean(part.inlineData?.data))
    .map((part) => `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`);

  if (outputUrls.length === 0) {
    throw new Error("Gemini não retornou nenhuma imagem de saída");
  }

  return { outputUrls, model };
}
