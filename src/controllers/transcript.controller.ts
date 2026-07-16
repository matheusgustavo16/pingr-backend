import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { ChatService } from "../services/chat.service";
import { MemberStatus } from "@prisma/client";

async function assertRoomAccess(roomId: string, userId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, companyId: true },
  });
  if (!room) {
    return { ok: false as const, status: 404, error: "Sala não encontrada" };
  }

  const isMember = await ChatService.verifyCompanyMember(userId, room.companyId);
  if (!isMember) {
    return { ok: false as const, status: 403, error: "Usuário não é membro ativo da empresa" };
  }

  return { ok: true as const };
}

/**
 * Lista sessões de call com transcrições do usuário logado
 * (iniciou a call ou falou nela), agrupadas por sessão.
 * GET /rooms/me/call-sessions
 */
export const listMyCallSessions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const memberships = await prisma.companyMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE },
      select: { companyId: true },
    });
    const companyIds = memberships.map((m) => m.companyId);

    if (companyIds.length === 0) {
      return res.json({ sessions: [] });
    }

    const sessions = await prisma.callSession.findMany({
      where: {
        room: { companyId: { in: companyIds } },
        transcriptSegments: { some: {} },
        OR: [
          { startedById: userId },
          { transcriptSegments: { some: { userId } } },
        ],
      },
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            company: { select: { id: true, title: true } },
          },
        },
        startedBy: { select: { id: true, name: true, picture: true } },
        transcriptSegments: {
          include: {
            user: { select: { id: true, name: true, picture: true } },
          },
          orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { transcriptSegments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        roomId: s.roomId,
        room: s.room,
        startedBy: s.startedBy,
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        transcriptSegmentCount: s._count.transcriptSegments,
        segments: s.transcriptSegments.map((seg) => ({
          id: seg.id,
          callSessionId: seg.callSessionId,
          roomId: seg.roomId,
          userId: seg.userId,
          user: seg.user,
          text: seg.text,
          isFinal: seg.isFinal,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence,
          createdAt: seg.createdAt,
        })),
      })),
    });
  } catch (error) {
    console.error("Erro ao listar sessões do usuário:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Lista transcrições de uma sala (paginado por cursor de createdAt)
 * GET /rooms/:roomId/transcripts?callSessionId=&cursor=&limit=
 */
export const listTranscripts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;
    const { callSessionId, cursor } = req.query as {
      callSessionId?: string;
      cursor?: string;
    };
    const limit = req.query.limit
      ? Math.min(parseInt(req.query.limit as string), 200)
      : 100;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const access = await assertRoomAccess(roomId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const segments = await prisma.transcriptSegment.findMany({
      where: {
        roomId,
        ...(callSessionId ? { callSessionId } : {}),
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        user: { select: { id: true, name: true, picture: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = segments.length > limit;
    const page = hasMore ? segments.slice(0, limit) : segments;
    page.reverse();

    return res.json({
      segments: page.map((s) => ({
        id: s.id,
        callSessionId: s.callSessionId,
        roomId: s.roomId,
        userId: s.userId,
        user: s.user,
        text: s.text,
        isFinal: s.isFinal,
        startMs: s.startMs,
        endMs: s.endMs,
        confidence: s.confidence,
        createdAt: s.createdAt,
      })),
      nextCursor: hasMore ? page[0].createdAt.toISOString() : null,
      hasMore,
    });
  } catch (error) {
    console.error("Erro ao listar transcrições:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Lista sessões de call de uma sala
 * GET /rooms/:roomId/call-sessions
 */
export const listCallSessions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { roomId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const access = await assertRoomAccess(roomId, userId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const sessions = await prisma.callSession.findMany({
      where: { roomId },
      include: {
        startedBy: { select: { id: true, name: true, picture: true } },
        _count: { select: { transcriptSegments: true, agentActionLogs: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        roomId: s.roomId,
        startedBy: s.startedBy,
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        transcriptSegmentCount: s._count.transcriptSegments,
        agentActionCount: s._count.agentActionLogs,
      })),
    });
  } catch (error) {
    console.error("Erro ao listar sessões de call:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
