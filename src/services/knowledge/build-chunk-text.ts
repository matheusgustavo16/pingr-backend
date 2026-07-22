import { MeetingSummary } from "@prisma/client";

function formatList(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => String(v)).filter(Boolean);
    return items.length ? items.map((v) => `- ${v}`).join("\n") : "(nenhum)";
  }
  return value ? String(value) : "(nenhum)";
}

/**
 * Texto único embedado por MeetingSummary — inclui todos os campos
 * estruturados (não só o `summary`) para que a busca semântica encontre
 * decisões/ações/riscos específicos, não só o resumo geral.
 */
export function buildChunkTextFromMeetingSummary(summary: MeetingSummary): string {
  return [
    `Resumo: ${summary.summary ?? "(nenhum)"}`,
    `Decisões:\n${formatList(summary.decisions)}`,
    `Ações:\n${formatList(summary.actionItems)}`,
    `Riscos:\n${formatList(summary.risks)}`,
    `Insights:\n${formatList(summary.insights)}`,
    `Tópicos discutidos:\n${formatList(summary.discussedTopics)}`,
    `Palavras-chave: ${summary.keywords.join(", ") || "(nenhuma)"}`,
  ].join("\n\n");
}
