import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { assertRoomAccess } from "./transcript.controller";
import { meetingSummaryService } from "../services/meeting-summary/meeting-summary.service";

/**
 * Resumo estruturado (IA) de uma call já encerrada.
 * GET /rooms/:roomId/call-sessions/:callSessionId/summary
 */
export const getCallSessionSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId, callSessionId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const access = await assertRoomAccess(roomId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const session = await prisma.callSession.findFirst({
      where: { id: callSessionId, roomId },
      select: { id: true, mergedIntoId: true },
    });
    if (!session) {
      return res.status(404).json({ error: "Sessão de call não encontrada" });
    }

    // Sessão que fez merge numa reconexão rápida não tem resumo próprio — o
    // resumo combinado vive na raiz do cluster (ver CLUSTER_GAP_MS).
    const rootCallSessionId = session.mergedIntoId ?? session.id;
    const summary = await meetingSummaryService.getByCallSession(rootCallSessionId);
    return res.json({ summary });
  } catch (error) {
    console.error("Erro ao buscar resumo da reunião:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Dispara a geração manual do resumo (botão "Gerar resumo" na lista de
 * transcrições) — só quando ainda não existe resumo em andamento/concluído
 * e a reunião (todo o cluster) já terminou.
 * POST /rooms/:roomId/call-sessions/:callSessionId/summary/generate
 */
export const generateCallSessionSummary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId, callSessionId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const access = await assertRoomAccess(roomId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const session = await prisma.callSession.findFirst({
      where: { id: callSessionId, roomId },
      select: { id: true, mergedIntoId: true },
    });
    if (!session) {
      return res.status(404).json({ error: "Sessão de call não encontrada" });
    }

    const rootCallSessionId = session.mergedIntoId ?? session.id;

    const stillActive = await prisma.callSession.findFirst({
      where: {
        OR: [{ id: rootCallSessionId }, { mergedIntoId: rootCallSessionId }],
        endedAt: null,
      },
      select: { id: true },
    });
    if (stillActive) {
      return res.status(409).json({ error: "A reunião ainda está em andamento" });
    }

    const existing = await meetingSummaryService.getByCallSession(rootCallSessionId);
    if (existing && existing.status !== "FAILED") {
      return res.json({ summary: existing });
    }

    const summary = await meetingSummaryService.triggerManualGeneration(rootCallSessionId);
    if (!summary) {
      return res.status(400).json({ error: "Nenhuma transcrição encontrada pra gerar resumo" });
    }
    return res.json({ summary });
  } catch (error) {
    console.error("Erro ao gerar resumo da reunião:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Mescla resumos "picotados" (várias CallSessions da mesma reunião que, por
 * serem anteriores ao merge automático por reconexão — ver CLUSTER_GAP_MS —
 * ganharam um resumo cada uma) num resumo único, regenerado a partir da
 * transcrição combinada. A sessão mais antiga do grupo vira a raiz; as
 * demais (e quem já apontava pra elas) passam a apontar pra ela, e os
 * resumos antigos são descartados em favor do novo combinado.
 * POST /rooms/:roomId/call-sessions/merge-summaries
 * body: { callSessionIds: string[] }
 */
export const mergeCallSessionSummaries = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;
    const callSessionIds = Array.isArray(req.body?.callSessionIds) ? req.body.callSessionIds : [];

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const access = await assertRoomAccess(roomId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    if (callSessionIds.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 resumos pra mesclar" });
    }

    const sessions = await prisma.callSession.findMany({
      where: { id: { in: callSessionIds }, roomId },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    if (sessions.length < 2) {
      return res.status(404).json({ error: "Sessões de call não encontradas" });
    }

    const rootCallSessionId = sessions[0].id;
    const otherIds = sessions.slice(1).map((s) => s.id);

    // Sessões que já apontavam pras "outras" (merges automáticos anteriores)
    // precisam vir junto — senão ficam órfãs, apontando pra uma raiz que
    // deixou de existir como raiz.
    const children = await prisma.callSession.findMany({
      where: { mergedIntoId: { in: otherIds } },
      select: { id: true },
    });
    const allMovingIds = [...otherIds, ...children.map((c) => c.id)];

    const stillActive = await prisma.callSession.findFirst({
      where: { id: { in: [rootCallSessionId, ...allMovingIds] }, endedAt: null },
      select: { id: true },
    });
    if (stillActive) {
      return res.status(409).json({ error: "Uma das reuniões ainda está em andamento" });
    }

    await prisma.callSession.updateMany({
      where: { id: { in: allMovingIds } },
      data: { mergedIntoId: rootCallSessionId },
    });
    await prisma.meetingSummary.deleteMany({ where: { callSessionId: { in: otherIds } } });

    const summary = await meetingSummaryService.triggerManualGeneration(rootCallSessionId);
    if (!summary) {
      return res.status(400).json({ error: "Nenhuma transcrição encontrada pra gerar resumo" });
    }
    return res.json({ summary, rootCallSessionId });
  } catch (error) {
    console.error("Erro ao mesclar resumos da reunião:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
