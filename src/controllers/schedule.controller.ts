import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { ScheduleService } from "../services/schedule.service";
import { prisma } from "../services/prisma.service";

/**
 * Cria um novo evento de calendário
 */
export const createScheduleEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const {
      title,
      startAt,
      endAt,
      companyId,
      roomId,
      provider,
      externalId,
      visibility,
      recurrenceRule,
      recurrenceUntil,
      categoryId,
    } = req.body;

    // Validações
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Título é obrigatório" });
    }

    if (!startAt || !endAt) {
      return res.status(400).json({ error: "Data de início e fim são obrigatórias" });
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Datas inválidas" });
    }

    if (startDate >= endDate) {
      return res.status(400).json({ error: "Data de início deve ser anterior à data de fim" });
    }

    if (!companyId) {
      return res.status(400).json({ error: "ID da empresa é obrigatório" });
    }

    let recurrenceUntilDate: Date | null = null;
    if (recurrenceUntil) {
      recurrenceUntilDate = new Date(recurrenceUntil);
      if (isNaN(recurrenceUntilDate.getTime())) {
        return res.status(400).json({ error: "Data limite de recorrência inválida" });
      }
    }

    // Verificar se o usuário pertence à empresa
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userId,
          companyId: companyId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    // Validar visibility
    const validVisibility = visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";

    // Criar o evento
    const event = await ScheduleService.createScheduleEvent({
      title: title.trim(),
      startAt: startDate,
      endAt: endDate,
      companyId,
      createdById: userId,
      roomId: roomId || undefined,
      provider: provider || undefined,
      externalId: externalId || undefined,
      visibility: validVisibility,
      recurrenceRule: recurrenceRule || undefined,
      recurrenceUntil: recurrenceUntilDate,
      categoryId: categoryId || null,
    });

    return res.status(201).json({ event });
  } catch (error: any) {
    console.error("Erro ao criar evento:", error);
    if (error.message?.startsWith("Regra de recorrência")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Lista eventos de uma empresa por range de datas
 */
export const listScheduleEventsByCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    if (!companyId) {
      return res.status(400).json({ error: "ID da empresa é obrigatório" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Data de início e fim são obrigatórias" });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: "Datas inválidas" });
    }

    if (start >= end) {
      return res.status(400).json({ error: "Data de início deve ser anterior à data de fim" });
    }

    // Verificar se o usuário pertence à empresa
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userId,
          companyId: companyId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    // Listar eventos (incluir privados apenas se for o criador)
    const includePrivate = req.query.includePrivate === "true";
    const events = await ScheduleService.listScheduleEventsByCompany(
      {
        companyId,
        startDate: start,
        endDate: end,
      },
      includePrivate,
      userId
    );

    return res.json({ events });
  } catch (error: any) {
    console.error("Erro ao listar eventos:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Vincula uma sala a um evento
 */
export const linkRoomToScheduleEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { eventId } = req.params;
    const { roomId } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: "ID do evento é obrigatório" });
    }

    if (!roomId) {
      return res.status(400).json({ error: "ID da sala é obrigatório" });
    }

    // Verificar se o evento existe e se o usuário tem permissão
    const event = await prisma.scheduleEvent.findUnique({
      where: { id: eventId },
      include: {
        company: true,
      },
    });

    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
    }

    // Verificar se o usuário pertence à empresa
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userId,
          companyId: event.companyId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    // Vincular a sala
    const updatedEvent = await ScheduleService.linkRoomToScheduleEvent(eventId, roomId);

    return res.json({ event: updatedEvent });
  } catch (error: any) {
    console.error("Erro ao vincular sala ao evento:", error);
    
    if (error.message === "Evento não encontrado" || error.message === "Sala não encontrada") {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message === "A sala deve pertencer à mesma empresa do evento") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Edita a série inteira de um evento (título, horário, visibilidade e/ou a
 * regra de recorrência)
 */
export const updateScheduleEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { eventId } = req.params;
    const { title, startAt, endAt, visibility, recurrenceRule, recurrenceUntil, categoryId } = req.body;

    const event = await prisma.scheduleEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
    }

    const membership = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: event.companyId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    let startDate: Date | undefined;
    let endDate: Date | undefined;
    if (startAt !== undefined) {
      startDate = new Date(startAt);
      if (isNaN(startDate.getTime())) {
        return res.status(400).json({ error: "Data de início inválida" });
      }
    }
    if (endAt !== undefined) {
      endDate = new Date(endAt);
      if (isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Data de fim inválida" });
      }
    }
    if (
      (startDate ?? event.startAt).getTime() >= (endDate ?? event.endAt).getTime()
    ) {
      return res.status(400).json({ error: "Data de início deve ser anterior à data de fim" });
    }

    let recurrenceUntilDate: Date | null | undefined;
    if (recurrenceUntil !== undefined) {
      recurrenceUntilDate = recurrenceUntil ? new Date(recurrenceUntil) : null;
      if (recurrenceUntilDate && isNaN(recurrenceUntilDate.getTime())) {
        return res.status(400).json({ error: "Data limite de recorrência inválida" });
      }
    }

    const updated = await ScheduleService.updateScheduleEvent(eventId, {
      title: title !== undefined ? title.trim() : undefined,
      startAt: startDate,
      endAt: endDate,
      visibility:
        visibility === "PUBLIC" || visibility === "PRIVATE" ? visibility : undefined,
      recurrenceRule: recurrenceRule !== undefined ? recurrenceRule || null : undefined,
      recurrenceUntil: recurrenceUntilDate,
      categoryId: categoryId !== undefined ? categoryId || null : undefined,
    });

    return res.json({ event: updated });
  } catch (error: any) {
    console.error("Erro ao editar evento:", error);
    if (error.message?.startsWith("Regra de recorrência")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Exclui a série inteira de um evento
 */
export const deleteScheduleEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { eventId } = req.params;
    const event = await prisma.scheduleEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
    }

    const membership = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: event.companyId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    await ScheduleService.deleteScheduleEvent(eventId);
    return res.json({ message: "Evento excluído" });
  } catch (error: any) {
    console.error("Erro ao excluir evento:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Edita ou cancela SÓ uma ocorrência de uma série recorrente (grava uma
 * exceção, não mexe no evento mestre nem nas demais ocorrências)
 */
export const updateEventOccurrence = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { eventId } = req.params;
    const { occurrenceDate, action, title, startAt, endAt, visibility } = req.body;

    if (!occurrenceDate) {
      return res.status(400).json({ error: "occurrenceDate é obrigatório" });
    }
    const occDate = new Date(occurrenceDate);
    if (isNaN(occDate.getTime())) {
      return res.status(400).json({ error: "occurrenceDate inválido" });
    }
    if (action !== "CANCELLED" && action !== "MODIFIED") {
      return res.status(400).json({ error: "action deve ser CANCELLED ou MODIFIED" });
    }

    const event = await prisma.scheduleEvent.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: "Evento não encontrado" });
    }
    if (!event.isRecurring) {
      return res.status(400).json({ error: "Este evento não é recorrente" });
    }

    const membership = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: event.companyId } },
    });
    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    const payload: Record<string, unknown> = {};
    if (action === "MODIFIED") {
      if (title !== undefined) payload.title = title.trim();
      if (startAt !== undefined) payload.startAt = new Date(startAt).toISOString();
      if (endAt !== undefined) payload.endAt = new Date(endAt).toISOString();
      if (visibility === "PUBLIC" || visibility === "PRIVATE") payload.visibility = visibility;
    }

    const exception = await ScheduleService.upsertEventOccurrenceException(
      eventId,
      occDate,
      action,
      payload
    );

    return res.json({ exception });
  } catch (error: any) {
    console.error("Erro ao editar ocorrência:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Busca o evento agendado associado a uma sala
 */
export const getScheduleEventByRoom = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({ error: "ID da sala é obrigatório" });
    }

    // Buscar o evento pela sala
    const event = await ScheduleService.getScheduleEventByRoom(roomId);

    if (!event) {
      return res.status(404).json({ error: "Nenhum evento agendado encontrado para esta sala" });
    }

    // Verificar se o usuário pertence à empresa do evento
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: userId,
          companyId: event.companyId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    return res.json({ event });
  } catch (error: any) {
    console.error("Erro ao buscar evento pela sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
