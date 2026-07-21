import type { SummaryJson } from "./summary-provider";

function section(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join("\n")}\n`;
}

export function buildSummaryMarkdown(json: SummaryJson): string {
  const parts = [
    "# Resumo da Reunião",
    "",
    json.summary,
    "",
    section("Decisões", json.decisions),
    section("Itens de Ação", json.actionItems),
    section("Riscos", json.risks),
    section("Insights", json.insights),
    section("Tópicos Discutidos", json.discussedTopics),
    json.keywords.length > 0 ? `**Palavras-chave:** ${json.keywords.join(", ")}` : "",
  ];

  return parts.filter((p) => p !== "").join("\n");
}
