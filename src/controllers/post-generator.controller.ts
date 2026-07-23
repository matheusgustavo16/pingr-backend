import { Response } from "express";
import { AgentKind, PostAssetJobStatus } from "@prisma/client";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { deleteFile, getSignedDeliveryUrl, uploadFile } from "../services/cloudinary.service";
import { ensurePostGeneratorTemplatesFolder } from "../services/document.service";
import { postTemplateService } from "../services/post-template/post-template.service";
import { postGenerationService } from "../services/post-generation/post-generation.service";
import { analyzeImageReference, analyzePdfReference, fetchTextReference } from "../services/post-generation/reference-analysis.service";
import { composeImagePrompt, type ComposerAgent } from "../services/post-generation/prompt-composer.service";
import { createPostGenerationSchema } from "../schemas/post-generator.schema";

function handleError(res: Response, error: unknown, context: string) {
  console.error(context, error);
  return res.status(500).json({ error: "Erro interno do servidor" });
}

/** Confere que templateIds/attachmentIds recebidos do client realmente pertencem à empresa do usuário. */
async function validateReferenceIds(
  companyId: string,
  templateIds: string[],
  attachmentIds: string[]
): Promise<string | null> {
  if (templateIds.length > 0) {
    const count = await prisma.postTemplate.count({ where: { id: { in: templateIds }, companyId } });
    if (count !== templateIds.length) return "Um ou mais templates selecionados são inválidos";
  }
  if (attachmentIds.length > 0) {
    const count = await prisma.document.count({ where: { id: { in: attachmentIds }, companyId } });
    if (count !== attachmentIds.length) return "Um ou mais documentos anexados são inválidos";
  }
  return null;
}

/** Documentos "raw" (PDF, docx etc) foram upados como private — a fileUrl crua 401. Assina antes de expor ao client. */
function signAttachmentRefs<T extends { fileUrl: string; fileName: string; fileType: string | null; publicId: string }>(
  attachments: T[]
): Omit<T, "publicId">[] {
  return attachments.map(({ publicId, ...rest }) => ({
    ...rest,
    fileUrl: getSignedDeliveryUrl({ publicId, fileUrl: rest.fileUrl, fileName: rest.fileName, fileType: rest.fileType }),
  }));
}

// ---- Templates ----

export const listTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const templates = await prisma.postTemplate.findMany({
      where: { companyId: companyId },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ templates });
  } catch (error) {
    return handleError(res, error, "Erro ao listar templates:");
  }
};

export const uploadTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    if (!req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ error: "Apenas arquivos de imagem são permitidos" });
    }

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const folder = await ensurePostGeneratorTemplatesFolder(companyId, userId);

    const uploadResult = await uploadFile(
      req.file.buffer,
      `post-templates/${companyId}`,
      req.file.originalname,
      req.file.mimetype
    );

    const template = await prisma.postTemplate.create({
      data: {
        companyId: companyId,
        createdById: userId,
        fileName: req.file.originalname,
        fileUrl: uploadResult.url,
        publicId: uploadResult.publicId,
        status: PostAssetJobStatus.PENDING,
        document: {
          create: {
            fileName: req.file.originalname,
            fileUrl: uploadResult.url,
            publicId: uploadResult.publicId,
            fileType: req.file.mimetype,
            fileSize: req.file.size,
            folderId: folder.id,
            companyId: companyId,
            uploadedById: userId,
          },
        },
      },
    });

    postTemplateService.enqueueForTemplate(template.id).catch((err) => {
      console.error(`[post-template] falha ao enfileirar template ${template.id}:`, err);
    });

    return res.status(201).json({ template });
  } catch (error) {
    return handleError(res, error, "Erro ao enviar template:");
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const template = await prisma.postTemplate.findFirst({
      where: { id: req.params.id, companyId: companyId },
    });
    if (!template) return res.status(404).json({ error: "Template não encontrado" });

    try {
      await deleteFile(template.publicId, "image/*");
    } catch (error) {
      console.error("Erro ao deletar template do Cloudinary:", error);
    }

    // Document some em cascade (onDelete: Cascade em postTemplateId).
    await prisma.postTemplate.delete({ where: { id: template.id } });

    return res.json({ message: "Template removido com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover template:");
  }
};

// ---- Generations ----

export const listGenerations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const generations = await prisma.postGeneration.findMany({
      where: { companyId: companyId },
      include: {
        templates: { select: { id: true, fileName: true, fileUrl: true } },
        attachments: { select: { id: true, fileName: true, fileUrl: true, fileType: true, publicId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = generations.length > limit;
    const page = hasMore ? generations.slice(0, limit) : generations;
    const signedPage = page.map((g) => ({ ...g, attachments: signAttachmentRefs(g.attachments) }));

    return res.json({
      generations: signedPage,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  } catch (error) {
    return handleError(res, error, "Erro ao listar gerações:");
  }
};

export const getGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const generation = await prisma.postGeneration.findFirst({
      where: { id: req.params.id, companyId: companyId },
      include: {
        templates: { select: { id: true, fileName: true, fileUrl: true } },
        attachments: { select: { id: true, fileName: true, fileUrl: true, fileType: true, publicId: true } },
      },
    });
    if (!generation) return res.status(404).json({ error: "Geração não encontrada" });

    return res.json({ generation: { ...generation, attachments: signAttachmentRefs(generation.attachments) } });
  } catch (error) {
    return handleError(res, error, "Erro ao buscar geração:");
  }
};

/**
 * Monta o prompt final que vai pro Replicate, analisando as referências anexadas
 * (imagens via visão, PDFs via extração de texto + resumo, texto puro direto) e
 * devolvendo um texto enxuto pro usuário revisar/editar antes de confirmar a geração.
 */
export const composeGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const parsed = createPostGenerationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const { prompt, templateIds, attachmentIds, agentId } = parsed.data;

    const validationError = await validateReferenceIds(companyId, templateIds, attachmentIds);
    if (validationError) return res.status(400).json({ error: validationError });

    let agent: ComposerAgent | null = null;
    if (agentId) {
      const agentRow = await prisma.agent.findFirst({
        where: { id: agentId, companyId: companyId, kind: AgentKind.COMPANY, isActive: true },
      });
      if (!agentRow) return res.status(400).json({ error: "Agente selecionado é inválido" });
      agent = {
        provider: agentRow.provider,
        model: agentRow.model,
        name: agentRow.name,
        specialty: agentRow.specialty,
        philosophy: agentRow.philosophy,
      };
    }

    const [templates, attachments] = await Promise.all([
      templateIds.length > 0
        ? prisma.postTemplate.findMany({ where: { id: { in: templateIds } } })
        : Promise.resolve([]),
      attachmentIds.length > 0
        ? prisma.document.findMany({ where: { id: { in: attachmentIds } } })
        : Promise.resolve([]),
    ]);

    const referenceNotes: string[] = [];

    for (const template of templates) {
      if (template.description) {
        referenceNotes.push(`Template "${template.fileName}": ${template.description}`);
      }
    }

    // Se o agente escolhido usa um provider com visão, a análise de imagens
    // anexadas passa a usar o provider dele também (em vez do fallback fixo
    // OpenAI -> Anthropic) — mantém a "intervenção" do agente consistente do
    // início ao fim da composição, não só na etapa de texto final.
    const imageAnalysisProvider =
      agent?.provider === "OPENAI" || agent?.provider === "ANTHROPIC" ? agent.provider : undefined;

    const attachmentAnalyses = await Promise.all(
      attachments.map(async (doc): Promise<string | null> => {
        // Anexos "raw" (PDF, docx etc) foram upados como private no Cloudinary — a
        // fileUrl crua 401. Precisa assinar antes de baixar o conteúdo pra análise.
        const signedUrl = getSignedDeliveryUrl({
          publicId: doc.publicId,
          fileUrl: doc.fileUrl,
          fileName: doc.fileName,
          fileType: doc.fileType,
        });
        try {
          if (doc.fileType?.startsWith("image/")) {
            return `Imagem anexada "${doc.fileName}": ${await analyzeImageReference(signedUrl, imageAnalysisProvider)}`;
          }
          if (doc.fileType === "application/pdf") {
            return `Documento anexado "${doc.fileName}": ${await analyzePdfReference(signedUrl)}`;
          }
          if (doc.fileType?.startsWith("text/")) {
            return `Documento anexado "${doc.fileName}": ${await fetchTextReference(signedUrl)}`;
          }
          // Tipo sem análise automática (docx, zip etc) — não vira matéria-prima pro
          // prompt, só logado; não faz sentido mandar "não influencia" pro compositor.
          return null;
        } catch (error) {
          console.error(`[post-generator] falha ao analisar anexo ${doc.id}:`, error);
          return null;
        }
      })
    );
    referenceNotes.push(...attachmentAnalyses.filter((note): note is string => note !== null));

    const { promptEn, promptPt } = await composeImagePrompt({ userRequest: prompt, referenceNotes, agent });

    return res.json({ composedPromptEn: promptEn, composedPromptPt: promptPt });
  } catch (error) {
    return handleError(res, error, "Erro ao montar prompt da geração:");
  }
};

export const createGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const parsed = createPostGenerationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "Dados inválidos" });
    }
    const { prompt, templateIds, attachmentIds } = parsed.data;

    const validationError = await validateReferenceIds(companyId, templateIds, attachmentIds);
    if (validationError) return res.status(400).json({ error: validationError });

    const generation = await prisma.postGeneration.create({
      data: {
        companyId: companyId,
        createdById: userId,
        prompt,
        replicateModel: process.env.REPLICATE_IMAGE_MODEL || "google/nano-banana",
        status: PostAssetJobStatus.PENDING,
        templates: { connect: templateIds.map((id) => ({ id })) },
        attachments: { connect: attachmentIds.map((id) => ({ id })) },
      },
      include: {
        templates: { select: { id: true, fileName: true, fileUrl: true } },
        attachments: { select: { id: true, fileName: true, fileUrl: true, fileType: true, publicId: true } },
      },
    });

    postGenerationService.enqueueForGeneration(generation.id).catch((err) => {
      console.error(`[post-generation] falha ao enfileirar geração ${generation.id}:`, err);
    });

    return res.status(201).json({ generation: { ...generation, attachments: signAttachmentRefs(generation.attachments) } });
  } catch (error) {
    return handleError(res, error, "Erro ao criar geração:");
  }
};

export const deleteGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const generation = await prisma.postGeneration.findFirst({
      where: { id: req.params.id, companyId: companyId },
    });
    if (!generation) return res.status(404).json({ error: "Geração não encontrada" });

    if (generation.publicId) {
      try {
        await deleteFile(generation.publicId, "image/*");
      } catch (error) {
        console.error("Erro ao deletar resultado do Cloudinary:", error);
      }
    }

    await prisma.postGeneration.delete({ where: { id: generation.id } });

    return res.json({ message: "Geração removida com sucesso" });
  } catch (error) {
    return handleError(res, error, "Erro ao remover geração:");
  }
};
