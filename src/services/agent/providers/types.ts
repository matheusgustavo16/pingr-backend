import type { AgentContext, ToolDef } from "../tools/types";

export interface AgentProviderResult {
  output: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
}

export interface AgentProviderHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface AgentProviderImage {
  /** Base64 puro, sem o prefixo `data:...;base64,`. */
  data: string;
  mediaType: string;
}

export interface AgentProviderRunOptions {
  model?: string;
  /** Turnos anteriores (mais antigo primeiro) — threading de memória
   *  multi-turn, ver agent-conversation.service.ts `postMessage`. */
  history?: AgentProviderHistoryEntry[];
  /** Imagem anexada à mensagem atual (ex: página de PDF renderizada) —
   *  ignorada por providers sem suporte a visão (DeepSeek). */
  image?: AgentProviderImage;
}

export interface AgentProvider {
  name: "anthropic" | "openai" | "deepseek";
  run: (
    ctx: AgentContext,
    message: string,
    tools: ToolDef[],
    system: string,
    opts?: AgentProviderRunOptions
  ) => Promise<AgentProviderResult>;
}
