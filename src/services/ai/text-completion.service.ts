import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface TextCompletionResult {
  text: string;
  providerName: "deepseek" | "openai" | "anthropic";
  model: string;
}

async function runOpenAiCompatible(
  systemPrompt: string,
  userPrompt: string,
  opts: { providerName: "openai" | "deepseek"; apiKey: string; baseURL?: string; model: string; maxTokens: number }
): Promise<TextCompletionResult> {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  const response = await client.chat.completions.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return { text: (response.choices[0]?.message?.content ?? "").trim(), providerName: opts.providerName, model: opts.model };
}

async function runAnthropic(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  modelOverride?: string | null
): Promise<TextCompletionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");

  const client = new Anthropic({ apiKey });
  const model = modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return { text, providerName: "anthropic", model };
}

/**
 * Tarefa de texto puro (sem visão) na ordem padrão da Pingr: DeepSeek -> OpenAI -> Anthropic.
 * Compartilhado por qualquer serviço que só precise mandar um prompt de sistema + user e
 * receber texto de volta (resumo de PDF, composição de prompt de imagem, etc).
 */
export async function runTextCompletion(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<TextCompletionResult> {
  if (process.env.DEEPSEEK_API_KEY) {
    return runOpenAiCompatible(systemPrompt, userPrompt, {
      providerName: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      maxTokens,
    });
  }
  if (process.env.OPENAI_API_KEY) {
    return runOpenAiCompatible(systemPrompt, userPrompt, {
      providerName: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o",
      maxTokens,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return runAnthropic(systemPrompt, userPrompt, maxTokens);
  }
  throw new Error("Nenhum provider de IA configurado — defina DEEPSEEK_API_KEY, OPENAI_API_KEY ou ANTHROPIC_API_KEY");
}

export type ForcedProvider = "DEEPSEEK" | "OPENAI" | "ANTHROPIC";

/**
 * Mesma tarefa de texto puro, mas tenta um provider específico primeiro —
 * usado quando um agente da empresa (com provider/model próprios) é
 * escolhido pra assumir a tarefa em vez do fallback automático. Se a chave
 * daquele provider não estiver configurada neste ambiente, não falha: cai
 * pro fallback padrão da Pingr (DeepSeek -> OpenAI -> Anthropic) em vez de
 * travar a geração por causa de uma chave que o agente pede mas não existe
 * aqui — DeepSeek é a base padrão da Pingr, sempre disponível como rede de
 * segurança.
 */
export async function runTextCompletionWithProvider(
  provider: ForcedProvider,
  model: string | null | undefined,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<TextCompletionResult> {
  if (provider === "DEEPSEEK" && process.env.DEEPSEEK_API_KEY) {
    return runOpenAiCompatible(systemPrompt, userPrompt, {
      providerName: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
      maxTokens,
    });
  }
  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) {
    return runOpenAiCompatible(systemPrompt, userPrompt, {
      providerName: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: model || process.env.OPENAI_MODEL || "gpt-4o",
      maxTokens,
    });
  }
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) {
    return runAnthropic(systemPrompt, userPrompt, maxTokens, model);
  }

  console.warn(
    `[text-completion] provider "${provider}" do agente sem chave configurada — caindo pro fallback padrão da Pingr`
  );
  return runTextCompletion(systemPrompt, userPrompt, maxTokens);
}
