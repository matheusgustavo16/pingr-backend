import { randomUUID } from "crypto";
import { Response } from "express";
import { PostAssetJobStatus } from "@prisma/client";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { postGenerationService } from "../services/post-generation/post-generation.service";
import { notifyProposalItemStatusChange } from "../services/chat/chat-post-proposal-notify.service";

/**
 * Dispara a geração de imagem de um post específico dentro de uma proposta
 * criada no chat (tool `generateContentPosts`) — qualquer membro da sala
 * pode clicar em qualquer aba, não só quem mencionou o agente. Reusa o mesmo
 * pipeline assíncrono (BullMQ) do Gerador de Conteúdo standalone; a única
 * diferença é a notificação em tempo real pro card no chat em vez de polling.
 * POST /chat/post-proposals/:proposalId/items/:itemId/generate
 */
export const generateProposalItem = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: "Usuário não autenticado" });

    const companyId = req.companyId;
    if (!companyId) return res.status(404).json({ error: "Empresa não encontrada" });

    const { proposalId, itemId } = req.params;

    const item = await prisma.chatPostProposalItem.findFirst({
      where: { id: itemId, proposalId },
      include: {
        proposal: { select: { id: true, companyId: true, taskId: true } },
        postGeneration: { select: { status: true } },
      },
    });
    if (!item || item.proposal.companyId !== companyId) {
      return res.status(404).json({ error: "Post não encontrado" });
    }

    if (item.postGeneration && item.postGeneration.status !== PostAssetJobStatus.FAILED) {
      return res.status(409).json({ error: "Este post já está sendo gerado ou já foi concluído" });
    }

    const attachmentIds = (
      await prisma.chatPostProposal.findUnique({
        where: { id: proposalId },
        select: { attachments: { select: { id: true } } },
      })
    )?.attachments.map((a) => a.id) ?? [];

    const generationId = randomUUID();
    const generation = await prisma.postGeneration.create({
      data: {
        id: generationId,
        companyId,
        createdById: userId,
        taskId: item.proposal.taskId,
        prompt: item.promptEn,
        replicateModel:
          process.env.IMAGE_PROVIDER === "replicate"
            ? process.env.REPLICATE_IMAGE_MODEL || "google/nano-banana"
            : process.env.GOOGLE_AI_IMAGE_MODEL || "gemini-3-pro-image",
        status: PostAssetJobStatus.PENDING,
        attachments: attachmentIds.length > 0 ? { connect: attachmentIds.map((id) => ({ id })) } : undefined,
      },
    });

    const claim = await prisma.chatPostProposalItem.updateMany({
      where: {
        id: itemId,
        proposalId,
        OR: [{ postGenerationId: null }, { postGeneration: { status: PostAssetJobStatus.FAILED } }],
      },
      data: { postGenerationId: generation.id },
    });

    if (claim.count === 0) {
      // Perdeu a corrida pra outro clique concorrente — desfaz a geração órfã.
      await prisma.postGeneration.delete({ where: { id: generation.id } }).catch(() => {});
      return res.status(409).json({ error: "Este post já está sendo gerado" });
    }

    postGenerationService.enqueueForGeneration(generation.id).catch((err) => {
      console.error(`[chat-post-proposal] falha ao enfileirar geração ${generation.id}:`, err);
    });

    await notifyProposalItemStatusChange(generation.id);

    return res.status(201).json({ status: generation.status });
  } catch (error) {
    console.error("Erro ao gerar post da proposta:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
