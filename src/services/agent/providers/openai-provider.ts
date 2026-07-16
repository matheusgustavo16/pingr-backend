import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { agentTools, type AgentContext } from "../tools";
import { buildSystemPrompt } from "./system-prompt";
import type { AgentProvider, AgentProviderResult } from "./types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY não configurada");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const toolSchemas: ChatCompletionTool[] = agentTools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

/**
 * No máximo uma chamada de tool por turno — mesma premissa do provider
 * Anthropic, para manter AgentActionLog com um único toolName por linha.
 */
async function run(ctx: AgentContext, message: string): Promise<AgentProviderResult> {
  const openai = getClient();
  const system = buildSystemPrompt(ctx);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: message },
  ];

  const first = await openai.chat.completions.create({
    model: MODEL,
    messages,
    tools: toolSchemas,
  });

  const choice = first.choices[0]?.message;
  const toolCall = choice?.tool_calls?.find((c) => c.type === "function");

  if (!toolCall || toolCall.type !== "function") {
    return {
      output: choice?.content?.trim() || "Não consegui gerar uma resposta.",
      toolName: null,
      toolArgs: null,
      toolResult: null,
    };
  }

  const tool = agentTools.find((t) => t.name === toolCall.function.name);
  let toolArgs: unknown = null;
  let toolResult: unknown = null;
  let toolError: string | null = null;

  try {
    toolArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
  } catch {
    toolArgs = {};
  }

  if (!tool) {
    toolError = `Ferramenta desconhecida: ${toolCall.function.name}`;
  } else {
    try {
      toolResult = await tool.run(ctx, toolArgs);
    } catch (err: any) {
      toolError = err?.message || "Erro ao executar ferramenta";
    }
  }

  const second = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      ...messages,
      {
        role: "assistant",
        content: choice?.content ?? null,
        tool_calls: choice?.tool_calls,
      } as ChatCompletionMessageParam,
      {
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolError ? `Erro: ${toolError}` : JSON.stringify(toolResult),
      },
    ],
    tools: toolSchemas,
  });

  return {
    output: second.choices[0]?.message?.content?.trim() || "Não consegui gerar uma resposta.",
    toolName: toolCall.function.name,
    toolArgs,
    toolResult: toolError ? { error: toolError } : toolResult,
  };
}

export const openaiProvider: AgentProvider = { name: "openai", run };
