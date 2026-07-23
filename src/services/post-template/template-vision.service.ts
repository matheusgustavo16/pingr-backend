import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface TemplateVisionResult {
  description: string;
  providerName: "anthropic" | "openai";
  model: string;
}

const SYSTEM_PROMPT = `Você é um assistente que descreve imagens de referência usadas como template para gerar posts de redes sociais.

Descreva em detalhe: composição/layout, paleta de cores, estilo visual (ex: minimalista, corporativo, vibrante), qualquer texto visível na imagem, elementos gráficos (ícones, formas, ilustrações), e o tom geral. A descrição deve ser útil como referência textual pra um modelo de geração de imagem recriar o mesmo estilo em outro conteúdo.

Responda apenas com a descrição em texto corrido, em português, sem markdown e sem preâmbulo.`;

async function runAnthropic(imageUrl: string): Promise<TemplateVisionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: "Descreva esta imagem de referência." },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { description: text, providerName: "anthropic", model };
}

async function runOpenAi(imageUrl: string): Promise<TemplateVisionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada");

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Descreva esta imagem de referência." },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  });

  const text = (response.choices[0]?.message?.content ?? "").trim();
  return { description: text, providerName: "openai", model };
}

/**
 * DeepSeek não tem modelo com visão hoje, então não entra nessa ordem (diferente
 * do fallback de 3 providers usado em summary-provider.ts). Entre os dois que
 * sobram, segue a preferência padrão da Pingr: OpenAI antes de Anthropic.
 *
 * `forceProvider` deixa um agente da empresa (escolhido pra assumir a geração
 * de um post) assumir também a análise visual das referências com o próprio
 * provider dele, em vez do fallback fixo — só se aplica a OPENAI/ANTHROPIC,
 * já que DeepSeek não tem visão.
 */
export async function analyzeTemplateImage(
  imageUrl: string,
  forceProvider?: "OPENAI" | "ANTHROPIC"
): Promise<TemplateVisionResult> {
  if (forceProvider === "OPENAI" && process.env.OPENAI_API_KEY) {
    return runOpenAi(imageUrl);
  }
  if (forceProvider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    return runAnthropic(imageUrl);
  }
  if (process.env.OPENAI_API_KEY) {
    return runOpenAi(imageUrl);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return runAnthropic(imageUrl);
  }
  throw new Error(
    "Nenhum provider de IA com visão configurado — defina OPENAI_API_KEY ou ANTHROPIC_API_KEY"
  );
}
