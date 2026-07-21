import { prisma } from "./prisma.service";
import { RoomTypes, EventExceptionAction } from "@prisma/client";
import {
  assertValidRecurrenceRule,
  expandOccurrences,
  occurrenceId,
} from "./schedule-recurrence.util";

export interface CreateScheduleEventData {
  title: string;
  startAt: Date;
  endAt: Date;
  companyId: string;
  createdById: string;
  roomId?: string;
  provider?: string;
  externalId?: string;
  visibility?: "PUBLIC" | "PRIVATE";
  recurrenceRule?: string;
  recurrenceUntil?: Date | null;
  categoryId?: string | null;
}

export interface UpdateScheduleEventData {
  title?: string;
  startAt?: Date;
  endAt?: Date;
  visibility?: "PUBLIC" | "PRIVATE";
  recurrenceRule?: string | null;
  recurrenceUntil?: Date | null;
  categoryId?: string | null;
}

export interface ListScheduleEventsParams {
  companyId: string;
  startDate: Date;
  endDate: Date;
}

const EVENT_INCLUDE = {
  company: { select: { id: true, title: true } },
  room: { select: { id: true, title: true, type: true } },
  createdBy: { select: { id: true, name: true, email: true, picture: true } },
  category: { select: { id: true, title: true, emoji: true } },
} as const;

export class ScheduleService {
  /** Garante que a categoria (se informada) pertence à empresa do evento. */
  private static async resolveCategoryId(
    companyId: string,
    categoryId: string | null | undefined
  ): Promise<string | null | undefined> {
    if (categoryId === undefined) return undefined;
    if (categoryId === null) return null;
    const category = await prisma.roomCategory.findFirst({ where: { id: categoryId, companyId } });
    return category ? category.id : null;
  }

  /**
   * Cria um novo evento de calendário
   * Se não houver roomId, cria uma sala automaticamente
   */
  static async createScheduleEvent(data: CreateScheduleEventData) {
    let roomId = data.roomId;

    if (data.recurrenceRule) {
      assertValidRecurrenceRule(data.recurrenceRule);
    }

    let categoryId = await this.resolveCategoryId(data.companyId, data.categoryId);

    // Se não houver sala, criar automaticamente
    if (!roomId) {
      const room = await prisma.room.create({
        data: {
          title: data.title,
          type: RoomTypes.MEETING,
          companyId: data.companyId,
        },
      });
      roomId = room.id;
    } else if (categoryId === undefined) {
      // Sala existente vinculada sem categoria explícita — herda a da sala.
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      categoryId = room?.categoryId ?? null;
    }

    // Criar o evento (sempre a primeira ocorrência — recorrências seguintes
    // nunca são gravadas, só calculadas na leitura via recurrenceRule)
    const event = await prisma.scheduleEvent.create({
      data: {
        title: data.title,
        startAt: data.startAt,
        endAt: data.endAt,
        companyId: data.companyId,
        createdById: data.createdById,
        roomId: roomId,
        provider: data.provider || null,
        externalId: data.externalId || null,
        visibility: data.visibility || "PUBLIC",
        isRecurring: !!data.recurrenceRule,
        recurrenceRule: data.recurrenceRule || null,
        recurrenceUntil: data.recurrenceUntil || null,
        categoryId: categoryId ?? null,
      },
      include: EVENT_INCLUDE,
    });

    // Associar o evento à sala através do eventRefId
    await prisma.room.update({
      where: { id: roomId },
      data: { eventRefId: event.id },
    });

    return event;
  }

  /**
   * Edita a série inteira de um evento (recorrente ou não) — título,
   * horário, visibilidade e/ou a própria regra de recorrência.
   */
  static async updateScheduleEvent(eventId: string, data: UpdateScheduleEventData) {
    if (data.recurrenceRule) {
      assertValidRecurrenceRule(data.recurrenceRule);
    }

    const existing = await prisma.scheduleEvent.findUniqueOrThrow({ where: { id: eventId } });
    const categoryId = await this.resolveCategoryId(existing.companyId, data.categoryId);

    return prisma.scheduleEvent.update({
      where: { id: eventId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.startAt !== undefined && { startAt: data.startAt }),
        ...(data.endAt !== undefined && { endAt: data.endAt }),
        ...(data.visibility !== undefined && { visibility: data.visibility }),
        ...(data.recurrenceRule !== undefined && {
          recurrenceRule: data.recurrenceRule,
          isRecurring: !!data.recurrenceRule,
        }),
        ...(data.recurrenceUntil !== undefined && {
          recurrenceUntil: data.recurrenceUntil,
        }),
        ...(categoryId !== undefined && { categoryId }),
      },
      include: EVENT_INCLUDE,
    });
  }

  /**
   * Exclui a série inteira. Exceções (EventException) somem junto via
   * onDelete: Cascade no schema.
   */
  static async deleteScheduleEvent(eventId: string) {
    await prisma.scheduleEvent.delete({ where: { id: eventId } });
  }

  /**
   * Cancela ou edita SÓ uma ocorrência de uma série recorrente, sem afetar
   * as demais — grava uma linha em EventException em vez de tocar no
   * evento mestre.
   */
  static async upsertEventOccurrenceException(
    eventId: string,
    occurrenceDate: Date,
    action: "CANCELLED" | "MODIFIED",
    payload?: Record<string, unknown>
  ) {
    return prisma.eventException.upsert({
      where: {
        eventId_occurrenceDate: { eventId, occurrenceDate },
      },
      create: {
        eventId,
        occurrenceDate,
        action: action as EventExceptionAction,
        payload: action === "MODIFIED" ? (payload as any) : undefined,
      },
      update: {
        action: action as EventExceptionAction,
        payload: action === "MODIFIED" ? (payload as any) : null,
      },
    });
  }

  /**
   * Lista eventos de uma empresa por range de datas
   * @param params - Parâmetros de listagem
   * @param includePrivate - Se true, inclui eventos privados (apenas para o criador)
   * @param userId - ID do usuário para filtrar eventos privados
   */
  static async listScheduleEventsByCompany(
    params: ListScheduleEventsParams,
    includePrivate: boolean = false,
    userId?: string
  ) {
    const visibilityFilter: any = !includePrivate
      ? { visibility: "PUBLIC" }
      : userId
      ? {
          OR: [
            { visibility: "PUBLIC" },
            { visibility: "PRIVATE", createdById: userId },
          ],
        }
      : { visibility: "PUBLIC" };

    // Eventos únicos: precisam estar inteiramente contidos no range pedido.
    const singleEvents = await prisma.scheduleEvent.findMany({
      where: {
        companyId: params.companyId,
        isRecurring: false,
        startAt: { gte: params.startDate },
        endAt: { lte: params.endDate },
        ...visibilityFilter,
      },
      include: EVENT_INCLUDE,
      orderBy: { startAt: "asc" },
    });

    // Séries recorrentes: o evento mestre pode ter começado bem antes do
    // range visível e ainda assim gerar ocorrências dentro dele — filtro é
    // "a série começou antes do fim do range E (não tem fim OU termina
    // depois do início do range)", não startAt/endAt do mestre em si.
    const recurringMasters = await prisma.scheduleEvent.findMany({
      where: {
        companyId: params.companyId,
        isRecurring: true,
        startAt: { lte: params.endDate },
        OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: params.startDate } }],
        ...visibilityFilter,
      },
      include: EVENT_INCLUDE,
    });

    let expandedOccurrences: any[] = [];
    if (recurringMasters.length > 0) {
      const exceptions = await prisma.eventException.findMany({
        where: { eventId: { in: recurringMasters.map((e) => e.id) } },
      });
      const exceptionsByEvent = new Map<string, typeof exceptions>();
      for (const exc of exceptions) {
        const list = exceptionsByEvent.get(exc.eventId) ?? [];
        list.push(exc);
        exceptionsByEvent.set(exc.eventId, list);
      }

      expandedOccurrences = recurringMasters.flatMap((master) => {
        if (!master.recurrenceRule) return [];
        const occurrences = expandOccurrences(
          {
            startAt: master.startAt,
            endAt: master.endAt,
            recurrenceRule: master.recurrenceRule,
            recurrenceUntil: master.recurrenceUntil,
          },
          params.startDate,
          params.endDate
        );
        const eventExceptions = exceptionsByEvent.get(master.id) ?? [];

        return occurrences
          .map((occ) => {
            const exception = eventExceptions.find(
              (e) => e.occurrenceDate.getTime() === occ.occurrenceDate.getTime()
            );
            if (exception?.action === "CANCELLED") return null;

            const payload = (exception?.payload as Record<string, unknown> | null) ?? {};
            const startAt =
              typeof payload.startAt === "string" ? new Date(payload.startAt) : occ.startAt;
            const endAt =
              typeof payload.endAt === "string" ? new Date(payload.endAt) : occ.endAt;

            return {
              ...master,
              id: occurrenceId(master.id, occ.occurrenceDate),
              parentEventId: master.id,
              occurrenceDate: occ.occurrenceDate,
              startAt,
              endAt,
              title: typeof payload.title === "string" ? payload.title : master.title,
              visibility:
                payload.visibility === "PUBLIC" || payload.visibility === "PRIVATE"
                  ? payload.visibility
                  : master.visibility,
              isModifiedOccurrence: !!exception && exception.action === "MODIFIED",
            };
          })
          .filter((o): o is NonNullable<typeof o> => o !== null);
      });
    }

    return [...singleEvents, ...expandedOccurrences].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime()
    );
  }

  /**
   * Vincula uma sala existente a um evento
   */
  static async linkRoomToScheduleEvent(eventId: string, roomId: string) {
    // Verificar se o evento existe
    const event = await prisma.scheduleEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error("Evento não encontrado");
    }

    // Verificar se a sala existe e pertence à mesma empresa
    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new Error("Sala não encontrada");
    }

    if (room.companyId !== event.companyId) {
      throw new Error("A sala deve pertencer à mesma empresa do evento");
    }

    // Atualizar o evento e associar o eventRefId na sala
    const updatedEvent = await prisma.$transaction(async (tx) => {
      // Atualizar o evento — herda a categoria da sala vinculada
      const event = await tx.scheduleEvent.update({
        where: { id: eventId },
        data: {
          roomId: roomId,
          categoryId: room.categoryId ?? null,
        },
        include: {
          company: {
            select: {
              id: true,
              title: true,
            },
          },
          room: {
            select: {
              id: true,
              title: true,
              type: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              picture: true,
            },
          },
          category: {
            select: { id: true, title: true, emoji: true },
          },
        },
      });

      // Associar o evento à sala através do eventRefId
      await tx.room.update({
        where: { id: roomId },
        data: { eventRefId: eventId },
      });

      return event;
    });

    return updatedEvent;
  }

  /**
   * Busca o evento agendado associado a uma sala através do eventRefId
   */
  static async getScheduleEventByRoom(roomId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        scheduledEvent: {
          include: {
            company: {
              select: {
                id: true,
                title: true,
              },
            },
            room: {
              select: {
                id: true,
                title: true,
                type: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
                picture: true,
              },
            },
            category: {
              select: { id: true, title: true, emoji: true },
            },
          },
        },
      },
    });

    if (!room || !room.scheduledEvent) {
      return null;
    }

    return room.scheduledEvent;
  }
}
