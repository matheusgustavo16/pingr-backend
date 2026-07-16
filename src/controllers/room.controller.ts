import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { RoomTypes } from "@prisma/client";
import { ChatService } from "../services/chat.service";
import { resolveUserCompany } from "../services/company.service";
import { WebSocketServer } from "../ws/socket-server";

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { title, type, categoryId, workspaceId, isOpen } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar a empresa do usuário (Dono ou membro ativo)
    const company = await resolveUserCompany(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    // Criar sala é ação estrutural do mapa — só admin/dono.
    const requester = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });

    if (!requester || (requester.role !== "OWNER" && requester.role !== "ADMIN")) {
      return res.status(403).json({ error: "Apenas administradores podem criar salas" });
    }

    if (!title) {
      return res.status(400).json({ error: "Título da sala é obrigatório" });
    }

    // Validar tipo (backend usa uppercase ENUM)
    const validTypes = Object.values(RoomTypes);
    const roomType = (type || "OFFICE").toUpperCase() as RoomTypes;

    if (!validTypes.includes(roomType)) {
      return res.status(400).json({ error: "Tipo de sala inválido" });
    }

    // Validar workspaceId se fornecido (deve pertencer à empresa)
    let validWorkspaceId: string | null = null;
    if (workspaceId && workspaceId !== "company") {
      const workspace = await prisma.workspace.findFirst({
        where: {
          id: workspaceId,
          companyId: company.id,
        },
      });
      if (workspace) {
        validWorkspaceId = workspaceId;
      }
    }

    // Validar categoryId se fornecido (deve pertencer à empresa)
    let validCategoryId: string | null = null;
    if (categoryId) {
      const category = await prisma.roomCategory.findFirst({
        where: { id: categoryId, companyId: company.id },
      });
      if (category) {
        validCategoryId = categoryId;
      }
    }

    // Criar a sala e o canal de chat (se for tipo CHAT) em uma transação
    const result = await prisma.$transaction(async (tx) => {
      // Nova sala entra no fim da lista da sidebar dentro da sua categoria.
      const roomCount = await tx.room.count({ where: { categoryId: validCategoryId } });

      const room = await tx.room.create({
        data: {
          title: title.trim(),
          type: roomType,
          companyId: company.id,
          categoryId: validCategoryId,
          workspaceId: validWorkspaceId,
          isOpen: Boolean(isOpen),
          order: roomCount,
        },
      });

      // Criar ChatChannel automaticamente para tipos que têm chat de texto
      if (
        roomType === RoomTypes.CHAT ||
        roomType === RoomTypes.ADVISORY ||
        roomType === RoomTypes.DEV
      ) {
        await ChatService.createChannelForRoom(room.id, tx);
      }

      return room;
    });

    const roomPayload = {
      id: result.id,
      title: result.title,
      type: result.type,
      categoryId: result.categoryId,
      workspaceId: result.workspaceId,
      isOpen: result.isOpen,
      x: result.x,
      y: result.y,
      order: result.order,
    };

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("ROOM_CREATED", { room: roomPayload });
    } catch (error) {
      console.error("Erro ao emitir ROOM_CREATED via socket:", error);
    }

    return res.status(201).json({ room: roomPayload });
  } catch (error) {
    console.error("Erro ao criar sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Info pública mínima de uma sala, sem autenticação.
 * Usada para decidir se um visitante não logado pode entrar direto (sala aberta)
 * ou se precisa fazer login (sala privada).
 */
export const getRoomPublicInfo = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const room = await prisma.room.findUnique({
      where: { id },
      select: { id: true, title: true, isOpen: true },
    });

    if (!room) {
      return res.status(404).json({ error: "Sala não encontrada" });
    }

    return res.json({
      id: room.id,
      title: room.title,
      isOpen: room.isOpen,
    });
  } catch (error) {
    console.error("Erro ao buscar info pública da sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateRoomPosition = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { x, y } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: "Posição inválida" });
    }

    const company = await resolveUserCompany(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    const room = await prisma.room.findFirst({
      where: { id, companyId: company.id },
    });

    if (!room) {
      return res
        .status(404)
        .json({ error: "Sala não encontrada ou permissão negada" });
    }

    const updated = await prisma.room.update({
      where: { id },
      data: { x, y },
    });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("ROOM_POSITION_UPDATED", { roomId: updated.id, x: updated.x, y: updated.y });
    } catch (error) {
      console.error("Erro ao emitir ROOM_POSITION_UPDATED via socket:", error);
    }

    return res.json({
      room: { id: updated.id, x: updated.x, y: updated.y },
    });
  } catch (error) {
    console.error("Erro ao atualizar posição da sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Reordena os canais de uma categoria na sidebar — só o dono da empresa
 * (mesma regra de permissão usada pra excluir canal).
 */
export const reorderRooms = async (req: AuthRequest, res: Response) => {
  try {
    const { categoryId, orderedIds } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!categoryId || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: "categoryId e orderedIds são obrigatórios" });
    }

    const company = await prisma.company.findFirst({
      where: { ownerId: userId },
    });

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada ou permissão negada" });
    }

    const rooms = await prisma.room.findMany({
      where: { categoryId, companyId: company.id, type: { not: "OFFICE" } },
      select: { id: true },
    });

    const validIds = new Set(rooms.map((r) => r.id));
    if (
      orderedIds.length !== validIds.size ||
      !orderedIds.every((id: string) => validIds.has(id))
    ) {
      return res.status(400).json({ error: "Lista de canais não bate com a categoria" });
    }

    await prisma.$transaction(
      orderedIds.map((id: string, index: number) =>
        prisma.room.update({ where: { id }, data: { order: index } })
      )
    );

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("ROOMS_REORDERED", { categoryId, orderedIds });
    } catch (error) {
      console.error("Erro ao emitir ROOMS_REORDERED via socket:", error);
    }

    return res.json({ categoryId, orderedIds });
  } catch (error) {
    console.error("Erro ao reordenar salas:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Verificar se a sala pertence à empresa do usuário
    const room = await prisma.room.findFirst({
      where: {
        id,
        company: {
          ownerId: userId,
        },
      },
    });

    if (!room) {
      return res
        .status(404)
        .json({ error: "Sala não encontrada ou permissão negada" });
    }

    await prisma.room.delete({
      where: { id },
    });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${room.companyId}`)
        .emit("ROOM_DELETED", { roomId: room.id, categoryId: room.categoryId });
    } catch (error) {
      console.error("Erro ao emitir ROOM_DELETED via socket:", error);
    }

    return res.json({ message: "Sala removida com sucesso" });
  } catch (error) {
    console.error("Erro ao remover sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
