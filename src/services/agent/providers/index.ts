import { AgentLLMProvider } from "@prisma/client";
import { anthropicProvider } from "./anthropic-provider";
import { openaiProvider } from "./openai-provider";
import { deepseekProvider } from "./deepseek-provider";
import type { AgentProvider } from "./types";

const providersByKind: Record<AgentLLMProvider, AgentProvider> = {
  ANTHROPIC: anthropicProvider,
  OPENAI: openaiProvider,
  DEEPSEEK: deepseekProvider,
};

/**
 * Retorna o provider configurado para um agente específico (Agent.provider).
 */
export function getAgentProvider(provider: AgentLLMProvider): AgentProvider {
  return providersByKind[provider];
}

/**
 * Fallback por env, usado só se um agente não tiver provider configurado
 * (não deveria acontecer — Agent.provider tem default ANTHROPIC). Permite
 * rodar o agente Pinguelo sem depender de uma chave específica.
 */
export function getDefaultAgentProvider(): AgentProvider {
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  if (process.env.OPENAI_API_KEY) return openaiProvider;
  if (process.env.DEEPSEEK_API_KEY) return deepseekProvider;
  throw new Error(
    "Nenhum provider de IA configurado — defina ANTHROPIC_API_KEY, OPENAI_API_KEY ou DEEPSEEK_API_KEY"
  );
}
