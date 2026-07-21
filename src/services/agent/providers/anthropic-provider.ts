import Anthropic from "@anthropic-ai/sdk";
import type { AgentContext, ToolDef } from "../tools/types";
import type { AgentProvider, AgentProviderResult, AgentProviderRunOptions } from "./types";
import { looksLikeUnfulfilledPromise, MAX_TOOL_ITERATIONS } from "./promise-detector";

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

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

const textOf = (blocks: Anthropic.ContentBlock[]) =>
  blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * Permite até MAX_TOOL_ITERATIONS tool calls em sequência no mesmo turno de
 * usuário (ex: checar agenda com getSchedule, depois criar com
 * createScheduleEvent) — AgentActionLog guarda a última tool executada.
 */
async function run(
  ctx: AgentContext,
  message: string,
  tools: ToolDef[],
  system: string,
  opts?: AgentProviderRunOptions
): Promise<AgentProviderResult> {
  const anthropic = getClient();
  const model = opts?.model || DEFAULT_MODEL;

  const toolSchemas: Anthropic.Tool[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const availableToolNames = toolSchemas.map((t) => t.name);

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

  let forceToolChoice = false;
  let finalOutput: string | null = null;
  let lastToolName: string | null = null;
  let lastToolArgs: unknown = null;
  let lastToolResult: unknown = null;

  for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools: toolSchemas,
      ...(forceToolChoice ? { tool_choice: { type: "any" as const } } : {}),
      messages,
    });
    forceToolChoice = false;

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    console.log(
      `[provider:anthropic] iter=${iteration} stop_reason=${response.stop_reason} toolUse=${toolUse?.name ?? "none"} availableTools=${JSON.stringify(availableToolNames)} content="${textOf(response.content).slice(0, 200)}"`
    );

    if (!toolUse) {
      // Modelo às vezes anuncia a ação em texto sem chamar a tool — força uma
      // tentativa extra com tool_choice obrigatório antes de aceitar como
      // final. Só ajuda se a tool certa estiver disponível.
      if (toolSchemas.length > 0 && looksLikeUnfulfilledPromise(textOf(response.content)) && iteration < MAX_TOOL_ITERATIONS) {
        console.log("[provider:anthropic] unfulfilled-promise detectado, forçando tool_choice=any na próxima chamada");
        forceToolChoice = true;
        continue;
      }
      finalOutput = textOf(response.content) || "Não consegui gerar uma resposta.";
      break;
    }

    const tool = tools.find((t) => t.name === toolUse.name);
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

    lastToolName = toolUse.name;
    lastToolArgs = toolUse.input;
    lastToolResult = toolError ? { error: toolError } : toolResult;

    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: toolError ? `Erro: ${toolError}` : JSON.stringify(toolResult),
          is_error: !!toolError,
        },
      ],
    });
  }

  // Se o teto de iterações foi atingido logo após executar uma tool, ainda
  // não existe texto final — sem isso o retorno cairia no fallback de erro
  // mesmo quando a última ação deu certo. Fecha com 1 chamada sem tools.
  if (finalOutput === null) {
    console.log("[provider:anthropic] loop terminou sem texto final, fazendo wrap-up");
    const wrapUp = await anthropic.messages.create({ model, max_tokens: 1024, system, messages });
    finalOutput = textOf(wrapUp.content) || null;
  }

  return {
    output: finalOutput ?? "Não consegui gerar uma resposta.",
    toolName: lastToolName,
    toolArgs: lastToolArgs,
    toolResult: lastToolResult,
  };
}

export const anthropicProvider: AgentProvider = { name: "anthropic", run };
