import { Queue, Worker, Job } from "bullmq";
import { Prisma, KnowledgeChunkStatus, KnowledgeSourceType } from "@prisma/client";
import { prisma } from "../prisma.service";
import { createRedisConnection } from "./redis-connection";
import { generateEmbedding } from "./embedding-provider";
import { buildChunkTextFromMeetingSummary } from "./build-chunk-text";
import { knowledgeUsageService } from "./knowledge-usage.service";

const QUEUE_NAME = "knowledge-embedding";

interface EmbeddingJobPayload {
  callSessionId: string;
}

let queue: Queue<EmbeddingJobPayload> | null = null;
let worker: Worker<EmbeddingJobPayload> | null = null;

function getQueue(): Queue<EmbeddingJobPayload> {
  if (!queue) {
    queue = new Queue<EmbeddingJobPayload>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queue;
}

/** Vetor pgvector é escrito via SQL raw — Unsupported("vector(n)") não entra no client gerado. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function processJob(job: Job<EmbeddingJobPayload>): Promise<void> {
  const { callSessionId } = job.data;

  const summary = await prisma.meetingSummary.findUnique({ where: { callSessionId } });
  if (!summary || summary.status !== "COMPLETED") {
    throw new Error(`MeetingSummary não está COMPLETED para callSession ${callSessionId}`);
  }

  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    include: { room: { select: { companyId: true, workspaceId: true, title: true } } },
  });
  if (!callSession) throw new Error(`CallSession ${callSessionId} não encontrada`);

  const { companyId, workspaceId, title } = callSession.room;
  const content = buildChunkTextFromMeetingSummary(summary);

  const chunk = await prisma.knowledgeChunk.upsert({
    where: {
      sourceType_sourceId_chunkIndex: {
        sourceType: KnowledgeSourceType.MEETING_SUMMARY,
        sourceId: callSessionId,
        chunkIndex: 0,
      },
    },
    create: {
      companyId,
      workspaceId,
      sourceType: KnowledgeSourceType.MEETING_SUMMARY,
      sourceId: callSessionId,
      chunkIndex: 0,
      sourceTitle: title,
      content,
      metadata: { roomId: callSession.roomId, callSessionId, keywords: summary.keywords } as Prisma.InputJsonValue,
      status: KnowledgeChunkStatus.PROCESSING,
    },
    update: {
      companyId,
      workspaceId,
      sourceTitle: title,
      content,
      metadata: { roomId: callSession.roomId, callSessionId, keywords: summary.keywords } as Prisma.InputJsonValue,
      status: KnowledgeChunkStatus.PROCESSING,
      errorMessage: null,
    },
  });

  const { vector, model, tokenCount } = await generateEmbedding(content);

  await prisma.$executeRaw`
    UPDATE knowledge_chunks
    SET embedding = ${toVectorLiteral(vector)}::vector,
        "embeddingModel" = ${model},
        "tokenCount" = ${tokenCount},
        status = ${KnowledgeChunkStatus.COMPLETED}::"KnowledgeChunkStatus",
        "errorMessage" = NULL,
        "updatedAt" = now()
    WHERE id = ${chunk.id}
  `;

  await knowledgeUsageService.record({ companyId, feature: "embedding", tokens: tokenCount });
}

function getWorker(): Worker<EmbeddingJobPayload> {
  if (!worker) {
    worker = new Worker<EmbeddingJobPayload>(QUEUE_NAME, processJob, {
      connection: createRedisConnection(),
      concurrency: 3,
    });
    worker.on("failed", async (job, err) => {
      if (!job) return;
      console.error(`[knowledge-embedding] job falhou para callSession ${job.data.callSessionId}:`, err);
      await prisma.knowledgeChunk
        .updateMany({
          where: { sourceType: KnowledgeSourceType.MEETING_SUMMARY, sourceId: job.data.callSessionId, chunkIndex: 0 },
          data: { status: KnowledgeChunkStatus.FAILED, errorMessage: err?.message || "Erro desconhecido" },
        })
        .catch(() => {});
    });
  }
  return worker;
}

/** Chamado quando um MeetingSummary chega a COMPLETED — ver meeting-summary.service.ts. */
async function enqueueForSummary(callSessionId: string): Promise<void> {
  await getQueue().add(
    "embed",
    { callSessionId },
    { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
  );
}

/** Deve ser chamado uma vez na inicialização do processo para começar a consumir jobs. */
function startWorker(): void {
  getWorker();
}

export const knowledgeEmbeddingService = {
  enqueueForSummary,
  startWorker,
};
