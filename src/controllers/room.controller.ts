import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { RoomTypes } from "@prisma/client";

export const createRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { title, type, categoryId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar a empresa do usuário (Dono)
    const company = await prisma.company.findFirst({
      where: { ownerId: userId },
    });

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
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

    // Criar a sala
    const room = await prisma.room.create({
      data: {
        title: title.trim(),
        type: roomType,
        companyId: company.id,
        categoryId: categoryId || null,
      },
    });

    return res.status(201).json({
      room: {
        id: room.id,
        title: room.title,
        type: room.type,
        categoryId: room.categoryId,
      },
    });
  } catch (error) {
    console.error("Erro ao criar sala:", error);
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

    return res.json({ message: "Sala removida com sucesso" });
  } catch (error) {
    console.error("Erro ao remover sala:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
