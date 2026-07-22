import { searchKnowledge } from "../../knowledge/knowledge-search.service";
import type { ToolDef } from "./types";

export const searchKnowledgeBaseTool: ToolDef = {
  name: "searchKnowledgeBase",
  description:
    "Busca semântica na base de conhecimento corporativo (resumos de reuniões passadas). Use para responder perguntas sobre o que foi discutido, decidido ou combinado em calls anteriores da empresa.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Pergunta ou termo de busca (linguagem natural).",
      },
      topK: {
        type: "number",
        description: "Quantos resultados retornar. Padrão 5, máximo 10.",
      },
    },
    required: ["query"],
  },
  run: async (ctx, input) => {
    const query = String(input?.query ?? "").trim();
    if (!query) throw new Error("query é obrigatória");

    const topK = typeof input?.topK === "number" && input.topK > 0 ? Math.min(input.topK, 10) : 5;

    const results = await searchKnowledge(query, { companyId: ctx.companyId, topK });

    return results.map((r) => ({
      sourceTitle: r.sourceTitle,
      callSessionId: r.sourceId,
      content: r.content,
      score: r.score,
    }));
  },
};
