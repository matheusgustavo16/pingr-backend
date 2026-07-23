import { Queue, Worker, Job } from "bullmq";
import { PostAssetJobStatus } from "@prisma/client";
import { prisma } from "../prisma.service";
import { createRedisConnection } from "../knowledge/redis-connection";
import { analyzeTemplateImage } from "./template-vision.service";

const QUEUE_NAME = "post-template-analysis";

interface AnalysisJobPayload {
  templateId: string;
}

let queue: Queue<AnalysisJobPayload> | null = null;
let worker: Worker<AnalysisJobPayload> | null = null;

function getQueue(): Queue<AnalysisJobPayload> {
  if (!queue) {
    queue = new Queue<AnalysisJobPayload>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queue;
}

async function processJob(job: Job<AnalysisJobPayload>): Promise<void> {
  const { templateId } = job.data;

  const template = await prisma.postTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error(`PostTemplate ${templateId} não encontrado`);

  await prisma.postTemplate.update({
    where: { id: templateId },
    data: { status: PostAssetJobStatus.PROCESSING, errorMessage: null },
  });

  const { description } = await analyzeTemplateImage(template.fileUrl);

  await prisma.postTemplate.update({
    where: { id: templateId },
    data: { status: PostAssetJobStatus.COMPLETED, description, errorMessage: null },
  });
}

function getWorker(): Worker<AnalysisJobPayload> {
  if (!worker) {
    worker = new Worker<AnalysisJobPayload>(QUEUE_NAME, processJob, {
      connection: createRedisConnection(),
      concurrency: 3,
    });
    worker.on("failed", async (job, err) => {
      if (!job) return;
      console.error(`[post-template-analysis] job falhou para template ${job.data.templateId}:`, err);
      await prisma.postTemplate
        .update({
          where: { id: job.data.templateId },
          data: { status: PostAssetJobStatus.FAILED, errorMessage: err?.message || "Erro desconhecido" },
        })
        .catch(() => {});
    });
  }
  return worker;
}

async function enqueueForTemplate(templateId: string): Promise<void> {
  await getQueue().add("analyze", { templateId }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}

/** Deve ser chamado uma vez na inicialização do processo pra começar a consumir jobs. */
function startWorker(): void {
  getWorker();
}

export const postTemplateService = {
  enqueueForTemplate,
  startWorker,
};
