import Anthropic from "@anthropic-ai/sdk";
import { agentTools, type AgentContext } from "../tools";
import { buildSystemPrompt } from "./system-prompt";
import type { AgentProvider, AgentProviderResult } from "./types";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada");
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const toolSchemas: Anthropic.Tool[] = agentTools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
}));

const textOf = (blocks: Anthropic.ContentBlock[]) =>
  blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * No máximo uma chamada de tool por turno — mantém AgentActionLog com um
 * único toolName por linha, fácil de auditar.
 */
async function run(ctx: AgentContext, message: string): Promise<AgentProviderResult> {
  const anthropic = getClient();
  const system = buildSystemPrompt(ctx);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

  const first = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: toolSchemas,
    messages,
  });

  const toolUse = first.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    return {
      output: textOf(first.content) || "Não consegui gerar uma resposta.",
      toolName: null,
      toolArgs: null,
      toolResult: null,
    };
  }

  const tool = agentTools.find((t) => t.name === toolUse.name);
  let toolResult: unknown = null;
  let toolError: string | null = null;

  if (!tool) {
    toolError = `Ferramenta desconhecida: ${toolUse.name}`;
  } else {
    try {
      toolResult = await tool.run(ctx, toolUse.input);
    } catch (err: any) {
      toolError = err?.message || "Erro ao executar ferramenta";
    }
  }

  const second = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    tools: toolSchemas,
    messages: [
      ...messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: toolError ? `Erro: ${toolError}` : JSON.stringify(toolResult),
            is_error: !!toolError,
          },
        ],
      },
    ],
  });

  return {
    output: textOf(second.content) || "Não consegui gerar uma resposta.",
    toolName: toolUse.name,
    toolArgs: toolUse.input,
    toolResult: toolError ? { error: toolError } : toolResult,
  };
}

export const anthropicProvider: AgentProvider = { name: "anthropic", run };
