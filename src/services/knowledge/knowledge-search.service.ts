import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.service";
import { generateEmbedding } from "./embedding-provider";
import { knowledgeUsageService } from "./knowledge-usage.service";
import { knowledgeSearchLogService } from "./knowledge-search-log.service";
import { MIN_KNOWLEDGE_SCORE } from "./knowledge-config";

export interface KnowledgeSearchResult {
  id: string;
  sourceType: string;
  sourceId: string;
  sourceTitle: string | null;
  content: string;
  metadata: unknown;
  score: number;
  meetingDate: Date | null;
}

export interface KnowledgeSearchOptions {
  companyId: string;
  workspaceId?: string;
  topK?: number;
  minScore?: number;
}

/**
 * Busca semântica em knowledge_chunks. `companyId` é sempre aplicado no
 * WHERE junto do operador de distância vetorial — nunca como pós-filtro —
 * para isolamento de tenant e para permitir uso do índice HNSW eficientemente.
 *
 * `meetingDate` vem de um LEFT JOIN com call_sessions (sourceId ==
 * callSessionId hoje, único sourceType existente) — resolvido em tempo de
 * busca para não precisar alterar a pipeline de embeddings já implementada.
 *
 * Resultados abaixo de MIN_KNOWLEDGE_SCORE (configurável via
 * MIN_KNOWLEDGE_SCORE) são descartados. Toda busca é logada em
 * KnowledgeSearchLog para observabilidade/calibração do threshold.
 */
export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions
): Promise<KnowledgeSearchResult[]> {
  const { companyId, workspaceId, topK = 5, minScore = MIN_KNOWLEDGE_SCORE } = options;

  const { vector, tokenCount } = await generateEmbedding(query);
  const vectorLiteral = `[${vector.join(",")}]`;

  const workspaceFilter = workspaceId ? Prisma.sql`AND kc."workspaceId" = ${workspaceId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      sourceType: string;
      sourceId: string;
      sourceTitle: string | null;
      content: string;
      metadata: unknown;
      score: number;
      meetingDate: Date | null;
    }>
  >(Prisma.sql`
    SELECT kc.id, kc."sourceType", kc."sourceId", kc."sourceTitle", kc.content, kc.metadata,
           1 - (kc.embedding <=> ${vectorLiteral}::vector) AS score,
           cs."createdAt" AS "meetingDate"
    FROM knowledge_chunks kc
    LEFT JOIN call_sessions cs ON cs.id = kc."sourceId" AND kc."sourceType" = 'MEETING_SUMMARY'
    WHERE kc."companyId" = ${companyId}
      AND kc.status = 'COMPLETED'
      AND kc.embedding IS NOT NULL
      ${workspaceFilter}
    ORDER BY kc.embedding <=> ${vectorLiteral}::vector
    LIMIT ${topK}
  `);

  await knowledgeUsageService.record({ companyId, feature: "search", tokens: tokenCount });

  const results = rows.filter((r) => r.score >= minScore);

  const avgScore = results.length
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : null;
  await knowledgeSearchLogService.record({ companyId, query, resultsFound: results.length, avgScore });

  return results;
}
