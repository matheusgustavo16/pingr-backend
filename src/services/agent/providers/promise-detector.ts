/**
 * Alguns modelos (deepseek em especial) às vezes respondem em texto anunciando
 * uma ação ("vou criar o evento", "deixe-me agendar") sem de fato emitir a
 * tool_call correspondente. O system prompt já pede pra nunca fazer isso, mas
 * na prática o modelo nem sempre obedece — este heurístico detecta essa
 * "promessa não cumprida" pra forçar um retry com tool_choice obrigatório.
 */
const PROMISE_PATTERN =
  /\b(vou|vamos|vou já|já vou|deixe[- ]me|deixa eu|irei|criarei|agendarei|marcarei|reservarei|vou criar|vou marcar|vou agendar)\b/i;

export function looksLikeUnfulfilledPromise(text: string | null | undefined): boolean {
  if (!text) return false;
  return PROMISE_PATTERN.test(text);
}

/**
 * Tarefas como "marcar reunião" precisam de mais de 1 tool call em sequência
 * (ex: getSchedule pra checar disponibilidade, depois createScheduleEvent
 * pra criar). Limite evita loop infinito se o modelo ficar encadeando tools
 * sem nunca fechar com uma resposta final.
 */
export const MAX_TOOL_ITERATIONS = 4;
