import { PDFParse } from "pdf-parse";
import { analyzeTemplateImage } from "../post-template/template-vision.service";

const PDF_TEXT_MAX_CHARS = 20000;
const TEXT_ANALYSIS_MAX_CHARS = 3000;

export async function analyzeImageReference(
  imageUrl: string,
  forceProvider?: "OPENAI" | "ANTHROPIC"
): Promise<string> {
  const { description } = await analyzeTemplateImage(imageUrl, forceProvider);
  return description;
}

/**
 * PDF vira referência extraindo o texto localmente (pdf-parse, sem IA) e
 * devolvendo o texto bruto pro compositor de prompt ler direto — nada de
 * resumir aqui: um resumo intermediário perderia copy/posicionamento exatos
 * que o documento especifica (ex: "texto na arte: ..." de cada variante de
 * post), que o usuário pode exigir palavra por palavra.
 */
export async function analyzePdfReference(pdfUrl: string): Promise<string> {
  const parser = new PDFParse({ url: pdfUrl });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) {
      return "PDF sem texto extraível automaticamente (provavelmente digitalizado/imagem) — não influencia o resultado.";
    }
    return text.length > PDF_TEXT_MAX_CHARS ? `${text.slice(0, PDF_TEXT_MAX_CHARS)}…` : text;
  } finally {
    await parser.destroy();
  }
}

/** Arquivos de texto puro não precisam de IA — o próprio conteúdo já serve de contexto. */
export async function fetchTextReference(fileUrl: string): Promise<string> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Não foi possível baixar o arquivo (status ${response.status})`);
  const text = await response.text();
  return text.length > TEXT_ANALYSIS_MAX_CHARS ? `${text.slice(0, TEXT_ANALYSIS_MAX_CHARS)}…` : text;
}
