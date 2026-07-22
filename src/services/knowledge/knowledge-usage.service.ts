import { prisma } from "../prisma.service";

const EMBEDDING_COST_PER_TOKEN_USD = 0.00000002; // text-embedding-3-small: ~$0.02 / 1M tokens

interface RecordUsageInput {
  companyId: string;
  feature: "embedding" | "search";
  tokens: number;
}

async function record({ companyId, feature, tokens }: RecordUsageInput): Promise<void> {
  if (tokens <= 0) return;
  await prisma.knowledgeUsage.create({
    data: {
      companyId,
      feature,
      tokens,
      costUsd: tokens * EMBEDDING_COST_PER_TOKEN_USD,
    },
  });
}

export const knowledgeUsageService = { record };
