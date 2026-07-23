import { Queue, Worker, Job } from "bullmq";
import { PostAssetJobStatus } from "@prisma/client";
import { prisma } from "./prisma.service";
import { createRedisConnection } from "./knowledge/redis-connection";
import { getSignedDeliveryUrl } from "./cloudinary.service";
import {
  analyzeImageReference,
  analyzePdfReference,
  fetchTextReference,
} from "./post-generation/reference-analysis.service";

const QUEUE_NAME = "document-analysis";

interface AnalysisJobPayload {
  documentId: string;
}

/** Mesmos três tipos que reference-analysis.service.ts já sabe analisar — o
 *  resto (docx, zip etc.) não vira matéria-prima automática. */
function isAnalyzableType(fileType: string | null | undefined): boolean {
  if (!fileType) return false;
  return fileType.startsWith("image/") || fileType === "application/pdf" || fileType.startsWith("text/");
}

let queue: Queue<AnalysisJobPayload> | null = null;
let worker: Worker<AnalysisJobPayload> | null = null;

function getQueue(): Queue<AnalysisJobPayload> {
  if (!queue) {
    queue = new Queue<AnalysisJobPayload>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queue;
}

async function analyzeDocument(document: {
  publicId: string;
  fileUrl: string;
  fileName: string;
  fileType: string | null;
}): Promise<string> {
  const signedUrl = getSignedDeliveryUrl({
    publicId: document.publicId,
    fileUrl: document.fileUrl,
    fileName: document.fileName,
    fileType: document.fileType,
  });

  if (document.fileType?.startsWith("image/")) {
    return analyzeImageReference(signedUrl);
  }
  if (document.fileType === "application/pdf") {
    return analyzePdfReference(signedUrl);
  }
  return fetchTextReference(signedUrl);
}

async function processJob(job: Job<AnalysisJobPayload>): Promise<void> {
  const { documentId } = job.data;

  const document = await prisma.document.findUnique({ where: { id: documentId } });
  if (!document) throw new Error(`Document ${documentId} não encontrado`);

  await prisma.document.update({
    where: { id: documentId },
    data: { analysisStatus: PostAssetJobStatus.PROCESSING, analysisError: null },
  });

  const description = await analyzeDocument(document);

  await prisma.document.update({
    where: { id: documentId },
    data: { analysisStatus: PostAssetJobStatus.COMPLETED, description, analysisError: null },
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
      console.error(`[document-analysis] job falhou para document ${job.data.documentId}:`, err);
      await prisma.document
        .update({
          where: { id: job.data.documentId },
          data: { analysisStatus: PostAssetJobStatus.FAILED, analysisError: err?.message || "Erro desconhecido" },
        })
        .catch(() => {});
    });
  }
  return worker;
}

/** No-op pra tipos sem análise automática — Document.analysisStatus fica null.
 *  Marca PENDING assim que enfileira, pra UI já refletir "na fila" sem
 *  esperar o worker pegar o job. */
async function enqueueForDocument(documentId: string, fileType: string | null | undefined): Promise<void> {
  if (!isAnalyzableType(fileType)) return;
  await prisma.document.update({
    where: { id: documentId },
    data: { analysisStatus: PostAssetJobStatus.PENDING, analysisError: null },
  });
  await getQueue().add("analyze", { documentId }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}

/** Deve ser chamado uma vez na inicialização do processo pra começar a consumir jobs. */
function startWorker(): void {
  getWorker();
}

export const documentAnalysisService = {
  enqueueForDocument,
  startWorker,
  isAnalyzableType,
  analyzeDocument,
};
