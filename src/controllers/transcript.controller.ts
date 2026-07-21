import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { ChatService } from "../services/chat.service";
import { MemberStatus } from "@prisma/client";

export async function assertRoomAccess(roomId: string, userId: string) {
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
 * Filtro base (companies do usuário + sessões onde ele iniciou ou falou),
 * compartilhado entre a listagem paginada e o endpoint de stats agregados.
 */
async function myCallSessionsWhere(userId: string, extra?: { roomId?: string; q?: string }) {
  const memberships = await prisma.companyMember.findMany({
    where: { userId, status: MemberStatus.ACTIVE },
    select: { companyId: true },
  });
  const companyIds = memberships.map((m) => m.companyId);

  if (companyIds.length === 0) return null;

  return {
    room: {
      companyId: { in: companyIds },
      ...(extra?.roomId ? { id: extra.roomId } : {}),
      ...(extra?.q ? { title: { contains: extra.q, mode: "insensitive" as const } } : {}),
    },
    transcriptSegments: { some: {} },
    OR: [{ startedById: userId }, { transcriptSegments: { some: { userId } } }],
  };
}

/**
 * Lista sessões de call com transcrições do usuário logado
 * (iniciou a call ou falou nela), paginada por cursor e agrupável por dia no
 * cliente (createdAt desc). Não devolve o texto completo dos trechos — só um
 * preview + contagem de palavras/tamanho, pra manter a página leve com scroll
 * infinito. O texto completo é buscado sob demanda em /:roomId/transcripts.
 * GET /rooms/me/call-sessions
 */
export const listMyCallSessions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const roomId = typeof req.query.roomId === "string" ? req.query.roomId : undefined;
    const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim() : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const where = await myCallSessionsWhere(userId, { roomId, q });
    if (!where) {
      return res.json({ sessions: [], nextCursor: null, hasMore: false });
    }

    const sessions = await prisma.callSession.findMany({
      where,
      include: {
        room: {
          select: {
            id: true,
            title: true,
            type: true,
            category: { select: { title: true, emoji: true } },
            company: { select: { id: true, title: true } },
          },
        },
        startedBy: { select: { id: true, name: true, picture: true } },
        transcriptSegments: {
          select: { text: true, userId: true, user: { select: { id: true, name: true, picture: true } } },
          orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
        },
        _count: { select: { transcriptSegments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = sessions.length > limit;
    const page = hasMore ? sessions.slice(0, limit) : sessions;

    return res.json({
      sessions: page.map((s) => {
        const fullText = s.transcriptSegments.map((seg) => seg.text).join(" ");
        const wordCount = fullText.trim() ? fullText.trim().split(/\s+/).length : 0;
        const sizeBytes = Buffer.byteLength(fullText, "utf8");
        const previewText = fullText.length > 220 ? `${fullText.slice(0, 220).trim()}…` : fullText;

        const participants = new Map<string, { id: string; name: string; picture?: string | null }>();
        for (const seg of s.transcriptSegments) {
          if (seg.user && !participants.has(seg.user.id)) participants.set(seg.user.id, seg.user);
        }

        return {
          id: s.id,
          roomId: s.roomId,
          room: s.room,
          startedBy: s.startedBy,
          createdAt: s.createdAt,
          endedAt: s.endedAt,
          transcriptSegmentCount: s._count.transcriptSegments,
          previewText,
          wordCount,
          sizeBytes,
          participants: Array.from(participants.values()),
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    });
  } catch (error) {
    console.error("Erro ao listar sessões do usuário:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Totais agregados (não paginados) pros stat cards da página de
 * transcrições — precisa ser um lifetime total, não só o que já carregou
 * no scroll infinito.
 * GET /rooms/me/call-sessions/stats
 */
export const getMyCallSessionStats = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const where = await myCallSessionsWhere(userId);
    if (!where) {
      return res.json({ totalSessions: 0, distinctRooms: 0, totalDurationMs: 0, lastSessionAt: null });
    }

    const sessions = await prisma.callSession.findMany({
      where,
      select: { roomId: true, createdAt: true, endedAt: true },
    });

    const totalDurationMs = sessions.reduce((sum, s) => {
      if (!s.endedAt) return sum;
      return sum + (s.endedAt.getTime() - s.createdAt.getTime());
    }, 0);

    const lastSessionAt = sessions.reduce<Date | null>(
      (max, s) => (!max || s.createdAt > max ? s.createdAt : max),
      null
    );

    return res.json({
      totalSessions: sessions.length,
      distinctRooms: new Set(sessions.map((s) => s.roomId)).size,
      totalDurationMs,
      lastSessionAt,
    });
  } catch (error) {
    console.error("Erro ao buscar stats de transcrições:", error);
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
