import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AgentContext, ToolDef } from "../tools/types";
import type { AgentProvider, AgentProviderResult, AgentProviderRunOptions } from "./types";
import { looksLikeUnfulfilledPromise, MAX_TOOL_ITERATIONS } from "./promise-detector";

export interface OpenAiCompatibleConfig {
  name: "openai" | "deepseek";
  apiKeyEnv: string;
  baseURL?: string;
  defaultModel: string;
  modelEnv: string;
}

/**
 * DeepSeek expõe uma API compatível com o SDK da OpenAI (mesmo formato de
 * request/response, só muda baseURL/model) — por isso os dois providers
 * compartilham esta factory em vez de duplicar o loop de tool-call.
 */
export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AgentProvider {
  let client: OpenAI | null = null;
  function getClient(): OpenAI {
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`${config.apiKeyEnv} não configurada`);
    }
    if (!client) {
      client = new OpenAI({ apiKey, baseURL: config.baseURL });
    }
    return client;
  }

  const defaultModel = process.env[config.modelEnv] || config.defaultModel;

  async function run(
    ctx: AgentContext,
    message: string,
    tools: ToolDef[],
    system: string,
    opts?: AgentProviderRunOptions
  ): Promise<AgentProviderResult> {
    const openai = getClient();
    const model = opts?.model || defaultModel;

    const toolSchemas: ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      { role: "user", content: message },
    ];

    const availableToolNames = toolSchemas.map((t) => (t.type === "function" ? t.function.name : t.type));

    let forceToolChoice = false;
    let finalOutput: string | null = null;
    let lastToolName: string | null = null;
    let lastToolArgs: unknown = null;
    let lastToolResult: unknown = null;

    // Tarefas tipo "marcar reunião" podem precisar de mais de 1 tool em
    // sequência (checar agenda, depois criar o evento) — por isso repete até
    // MAX_TOOL_ITERATIONS em vez de parar após a 1ª rodada de tool_call.
    for (let iteration = 1; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
      const response = await openai.chat.completions.create({
        model,
        messages,
        tools: toolSchemas,
        ...(forceToolChoice ? { tool_choice: "required" as const } : {}),
      });
      forceToolChoice = false;

      const choice = response.choices[0]?.message;
      const toolCall = choice?.tool_calls?.find((c) => c.type === "function");

      console.log(
        `[provider:${config.name}] iter=${iteration} finish_reason=${response.choices[0]?.finish_reason} toolCall=${toolCall?.function?.name ?? "none"} availableTools=${JSON.stringify(availableToolNames)} content="${(choice?.content ?? "").slice(0, 200)}"`
      );

      if (!toolCall || toolCall.type !== "function") {
        // Modelo às vezes anuncia a ação em texto ("vou criar o evento") sem
        // chamar a tool — força uma tentativa extra com tool_choice
        // obrigatório antes de aceitar a resposta como final. Só ajuda se a
        // tool certa estiver disponível; o log acima mostra as duas situações.
        if (toolSchemas.length > 0 && looksLikeUnfulfilledPromise(choice?.content) && iteration < MAX_TOOL_ITERATIONS) {
          console.log(`[provider:${config.name}] unfulfilled-promise detectado, forçando tool_choice=required na próxima chamada`);
          forceToolChoice = true;
          continue;
        }
        finalOutput = choice?.content?.trim() || "Não consegui gerar uma resposta.";
        break;
      }

      const tool = tools.find((t) => t.name === toolCall.function.name);
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

      lastToolName = toolCall.function.name;
      lastToolArgs = toolArgs;
      lastToolResult = toolError ? { error: toolError } : toolResult;

      messages.push({
        role: "assistant",
        content: choice?.content ?? null,
        tool_calls: choice?.tool_calls,
      } as ChatCompletionMessageParam);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolError ? `Erro: ${toolError}` : JSON.stringify(toolResult),
      });
    }

    // Se o teto de iterações foi atingido logo após executar uma tool, ainda
    // não existe texto final — sem isso o retorno cairia no fallback de erro
    // mesmo quando a última ação deu certo. Fecha com 1 chamada sem tools.
    if (finalOutput === null) {
      console.log(`[provider:${config.name}] loop terminou sem texto final, fazendo wrap-up`);
      const wrapUp = await openai.chat.completions.create({ model, messages });
      finalOutput = wrapUp.choices[0]?.message?.content?.trim() || null;
    }

    return {
      output: finalOutput ?? "Não consegui gerar uma resposta.",
      toolName: lastToolName,
      toolArgs: lastToolArgs,
      toolResult: lastToolResult,
    };
  }

  return { name: config.name, run };
}
