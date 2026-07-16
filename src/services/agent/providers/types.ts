import type { AgentContext } from "../tools/types";

export interface AgentProviderResult {
  output: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: unknown;
}

export interface AgentProvider {
  name: "anthropic" | "openai";
  run: (ctx: AgentContext, message: string) => Promise<AgentProviderResult>;
}
