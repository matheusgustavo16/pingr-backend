import { prisma } from "../prisma.service";

interface RecordSearchLogInput {
  companyId: string;
  query: string;
  resultsFound: number;
  avgScore: number | null;
}

async function record({ companyId, query, resultsFound, avgScore }: RecordSearchLogInput): Promise<void> {
  await prisma.knowledgeSearchLog.create({
    data: { companyId, query, resultsFound, avgScore },
  });
}

export const knowledgeSearchLogService = { record };
