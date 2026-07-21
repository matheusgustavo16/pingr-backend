import type { AgentContext, ToolDef } from "../tools/types";

export interface AgentProviderResult {
  output: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
}

export interface AgentProviderRunOptions {
  model?: string;
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
