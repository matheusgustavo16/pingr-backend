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
      select: { id: true },
    });
    if (!session) {
      return res.status(404).json({ error: "Sessão de call não encontrada" });
    }

    const summary = await meetingSummaryService.getByCallSession(callSessionId);
    return res.json({ summary });
  } catch (error) {
    console.error("Erro ao buscar resumo da reunião:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
