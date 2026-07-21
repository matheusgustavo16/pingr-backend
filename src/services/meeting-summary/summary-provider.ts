import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface SummaryJson {
  summary: string;
  decisions: string[];
  actionItems: string[];
  risks: string[];
  insights: string[];
  discussedTopics: string[];
  keywords: string[];
}

export interface SummaryResult {
  json: SummaryJson;
  providerName: "anthropic" | "openai" | "deepseek";
  model: string;
}

const SYSTEM_PROMPT = `Você é um assistente que gera resumos estruturados de reuniões a partir de transcrições brutas (formato "Nome: fala").

Responda APENAS com um objeto JSON válido (sem markdown, sem texto antes/depois), com exatamente estas chaves:
{
  "summary": "resumo geral da reunião em um parágrafo",
  "decisions": ["decisão 1", "decisão 2"],
  "actionItems": ["item de ação 1", "item de ação 2"],
  "risks": ["risco 1", "risco 2"],
  "insights": ["insight 1", "insight 2"],
  "discussedTopics": ["tópico 1", "tópico 2"],
  "keywords": ["palavra-chave 1", "palavra-chave 2"]
}

Todas as listas devem ser arrays de strings (podem ser vazias se não houver nada relevante). Escreva em português.`;

function buildUserPrompt(transcript: string): string {
  return `Transcrição da reunião:\n\n${transcript}\n\nGere o resumo estruturado em JSON conforme instruído.`;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v));
}

function parseSummaryJson(text: string): SummaryJson {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  const parsed = JSON.parse(raw);
  return {
    summary: String(parsed.summary ?? ""),
    decisions: toStringArray(parsed.decisions),
    actionItems: toStringArray(parsed.actionItems),
    risks: toStringArray(parsed.risks),
    insights: toStringArray(parsed.insights),
    discussedTopics: toStringArray(parsed.discussedTopics),
    keywords: toStringArray(parsed.keywords),
  };
}

async function runAnthropic(transcript: string): Promise<SummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada");

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(transcript) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { json: parseSummaryJson(text), providerName: "anthropic", model };
}

async function runOpenAiCompatible(
  transcript: string,
  opts: { providerName: "openai" | "deepseek"; apiKey: string; baseURL?: string; model: string }
): Promise<SummaryResult> {
  const client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });

  const response = await client.chat.completions.create({
    model: opts.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(transcript) },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return { json: parseSummaryJson(text), providerName: opts.providerName, model: opts.model };
}

/**
 * Mesma ordem de fallback por env de getDefaultAgentProvider() (ver
 * services/agent/providers/index.ts), mas com um provider próprio pedindo
 * saída JSON estrita em vez do loop de tool-calling do agente de voz/chat.
 */
export async function generateMeetingSummary(transcript: string): Promise<SummaryResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    return runAnthropic(transcript);
  }
  if (process.env.OPENAI_API_KEY) {
    return runOpenAiCompatible(transcript, {
      providerName: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o",
    });
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return runOpenAiCompatible(transcript, {
      providerName: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    });
  }
  throw new Error(
    "Nenhum provider de IA configurado — defina ANTHROPIC_API_KEY, OPENAI_API_KEY ou DEEPSEEK_API_KEY"
  );
}
