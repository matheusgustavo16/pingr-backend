/**
 * Score mínimo de similaridade (cosine, 0-1) para um resultado de busca
 * semântica ser considerado relevante. Resultados abaixo são descartados
 * em searchKnowledge antes de retornar/logar. Ajustável via env sem
 * precisar de deploy de código.
 *
 * Default calibrado empiricamente com text-embedding-3-small sobre um
 * chunk no formato real do pipeline (summary+decisions+actionItems+...):
 * queries relevantes pontuaram 0.37–0.60, query fora de tópico pontuou
 * 0.18. Cosine similarity desse modelo raramente passa de ~0.7-0.8 mesmo
 * pra matches fortes — 0.75 (comum em outros modelos/normalizações)
 * descartaria praticamente todo resultado relevante aqui. Recalibrar
 * quando houver volume real de MeetingSummary + KnowledgeSearchLog.
 */
export const MIN_KNOWLEDGE_SCORE = (() => {
  const raw = process.env.MIN_KNOWLEDGE_SCORE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0.3;
})();
