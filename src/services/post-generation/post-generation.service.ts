import { Queue, Worker, Job } from "bullmq";
import { PostAssetJobStatus } from "@prisma/client";
import { prisma } from "../prisma.service";
import { createRedisConnection } from "../knowledge/redis-connection";
import { generateImage as generateImageReplicate } from "../replicate.service";
import { generateImage as generateImageGemini } from "../gemini.service";
import { uploadImageFromUrl } from "../cloudinary.service";
import { ensurePostGeneratorGenerationsFolder } from "../document.service";
import { notifyProposalItemStatusChange } from "../chat/chat-post-proposal-notify.service";
import { notifyPostGenerationStatusChange } from "./post-generation-notify.service";

/** "gemini" (Nano Banana Pro, default) ou "replicate". */
function getGenerateImage() {
  const provider = process.env.IMAGE_PROVIDER || "gemini";
  return provider === "replicate" ? generateImageReplicate : generateImageGemini;
}

/** Primeira linha não vazia do prompt, sem o prefixo de contexto (Formato/Tom/Idioma), pro nome do arquivo. */
function fileNameFromPrompt(prompt: string): string {
  const lines = prompt.split("\n").map((l) => l.trim()).filter(Boolean);
  const contentLine = lines.find((l) => !l.startsWith("Formato:")) || lines[0] || "Post gerado";
  const truncated = contentLine.length > 60 ? `${contentLine.slice(0, 60)}…` : contentLine;
  return `${truncated}.png`;
}

const QUEUE_NAME = "post-generation";

interface GenerationJobPayload {
  generationId: string;
}

let queue: Queue<GenerationJobPayload> | null = null;
let worker: Worker<GenerationJobPayload> | null = null;

function getQueue(): Queue<GenerationJobPayload> {
  if (!queue) {
    queue = new Queue<GenerationJobPayload>(QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queue;
}

async function processJob(job: Job<GenerationJobPayload>): Promise<void> {
  const { generationId } = job.data;

  const generation = await prisma.postGeneration.findUnique({
    where: { id: generationId },
    include: { templates: true, attachments: true },
  });
  if (!generation) throw new Error(`PostGeneration ${generationId} não encontrado`);

  await prisma.postGeneration.update({
    where: { id: generationId },
    data: { status: PostAssetJobStatus.PROCESSING, errorMessage: null },
  });

  // O modelo de imagem só aceita referências visuais — anexos que não são
  // imagem (PDF, docx etc.) ficam salvos na geração mas não entram no
  // image_input, já que não há extração de conteúdo de texto/documento aqui.
  const imageAttachmentUrls = generation.attachments
    .filter((doc) => doc.fileType?.startsWith("image/"))
    .map((doc) => doc.fileUrl);
  const referenceImageUrls = [...generation.templates.map((t) => t.fileUrl), ...imageAttachmentUrls];
  const { outputUrls, model } = await getGenerateImage()({ prompt: generation.prompt, referenceImageUrls });

  const { url, publicId, fileSize } = await uploadImageFromUrl(
    outputUrls[0],
    `post-generations/${generation.companyId}`
  );

  const folder = await ensurePostGeneratorGenerationsFolder(generation.companyId, generation.createdById);

  await prisma.postGeneration.update({
    where: { id: generationId },
    data: {
      status: PostAssetJobStatus.COMPLETED,
      resultUrl: url,
      publicId,
      replicateModel: model,
      errorMessage: null,
      document: {
        create: {
          fileName: fileNameFromPrompt(generation.prompt),
          fileUrl: url,
          publicId,
          fileType: "image/png",
          fileSize,
          folderId: folder.id,
          companyId: generation.companyId,
          uploadedById: generation.createdById,
        },
      },
    },
  });

  await notifyProposalItemStatusChange(generationId);
  await notifyPostGenerationStatusChange(generationId);
}

function getWorker(): Worker<GenerationJobPayload> {
  if (!worker) {
    worker = new Worker<GenerationJobPayload>(QUEUE_NAME, processJob, {
      connection: createRedisConnection(),
      concurrency: 2,
    });
    worker.on("failed", async (job, err) => {
      if (!job) return;
      console.error(`[post-generation] job falhou para geração ${job.data.generationId}:`, err);
      await prisma.postGeneration
        .update({
          where: { id: job.data.generationId },
          data: { status: PostAssetJobStatus.FAILED, errorMessage: err?.message || "Erro desconhecido" },
        })
        .catch(() => {});
      await notifyProposalItemStatusChange(job.data.generationId).catch(() => {});
      await notifyPostGenerationStatusChange(job.data.generationId).catch(() => {});
    });
  }
  return worker;
}

async function enqueueForGeneration(generationId: string): Promise<void> {
  await getQueue().add(
    "generate",
    { generationId },
    { attempts: 2, backoff: { type: "exponential", delay: 8000 } }
  );
}

/** Deve ser chamado uma vez na inicialização do processo pra começar a consumir jobs. */
function startWorker(): void {
  getWorker();
}

export const postGenerationService = {
  enqueueForGeneration,
  startWorker,
};
