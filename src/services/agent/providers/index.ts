import { anthropicProvider } from "./anthropic-provider";
import { openaiProvider } from "./openai-provider";
import type { AgentProvider } from "./types";

/**
 * Claude é o provider padrão. Se ANTHROPIC_API_KEY não estiver definida,
 * cai para OpenAI (se OPENAI_API_KEY estiver configurada) — permite rodar
 * o agente PINGR sem depender de uma chave específica.
 */
export function getAgentProvider(): AgentProvider {
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  throw new Error(
    "Nenhum provider de IA configurado — defina ANTHROPIC_API_KEY ou OPENAI_API_KEY"
  );
}

export type { AgentProvider, AgentProviderResult } from "./types";
