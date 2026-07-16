import { prisma } from "./prisma.service";
import { RoomTypes } from "@prisma/client";

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
}

export interface ListScheduleEventsParams {
  companyId: string;
  startDate: Date;
  endDate: Date;
}

export class ScheduleService {
  /**
   * Cria um novo evento de calendário
   * Se não houver roomId, cria uma sala automaticamente
   */
  static async createScheduleEvent(data: CreateScheduleEventData) {
    let roomId = data.roomId;

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
    }

    // Criar o evento
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
      },
    });

    // Associar o evento à sala através do eventRefId
    await prisma.room.update({
      where: { id: roomId },
      data: { eventRefId: event.id },
    });

    return event;
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
    const where: any = {
      companyId: params.companyId,
      startAt: {
        gte: params.startDate,
      },
      endAt: {
        lte: params.endDate,
      },
    };

    // Se não incluir privados, filtrar apenas públicos
    // Se incluir privados, mostrar públicos + privados do usuário
    if (!includePrivate) {
      where.visibility = "PUBLIC";
    } else if (userId) {
      where.OR = [
        { visibility: "PUBLIC" },
        { visibility: "PRIVATE", createdById: userId },
      ];
    } else {
      where.visibility = "PUBLIC";
    }

    const events = await prisma.scheduleEvent.findMany({
      where,
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
      },
      orderBy: {
        startAt: "asc",
      },
    });

    return events;
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
      // Atualizar o evento
      const event = await tx.scheduleEvent.update({
        where: { id: eventId },
        data: {
          roomId: roomId,
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
