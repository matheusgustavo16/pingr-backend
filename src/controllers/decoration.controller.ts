import { Response } from "express";
import { prisma } from "../services/prisma.service";
import { AuthRequest } from "../middleware/auth.middleware";
import { resolveUserCompany } from "../services/company.service";
import { WebSocketServer } from "../ws/socket-server";

// Decorações são puramente visuais (planta etc) — só admin/dono do mapa
// pode criar/mover, mesma regra do "modo editor" das salas.
async function requireCompanyAdmin(userId: string) {
  const company = await resolveUserCompany(userId);
  if (!company) return { company: null, isAdmin: false };

  const requester = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId, companyId: company.id } },
  });

  const isAdmin = !!requester && (requester.role === "OWNER" || requester.role === "ADMIN");
  return { company, isAdmin };
}

export const createDecoration = async (req: AuthRequest, res: Response) => {
  try {
    const { type, x, y, scale } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).json({ error: "Posição inválida" });
    }

    if (scale !== undefined && scale !== 1 && scale !== 2) {
      return res.status(400).json({ error: "Escala inválida" });
    }

    const { company, isAdmin } = await requireCompanyAdmin(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    if (!isAdmin) {
      return res.status(403).json({ error: "Apenas administradores podem adicionar decorações" });
    }

    const decoration = await prisma.officeDecoration.create({
      data: {
        type: typeof type === "string" && type.trim() ? type.trim() : "plant",
        x,
        y,
        scale: scale === 2 ? 2 : 1,
        companyId: company.id,
      },
    });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("DECORATION_CREATED", { decoration });
    } catch (error) {
      console.error("Erro ao emitir DECORATION_CREATED via socket:", error);
    }

    return res.status(201).json({ decoration });
  } catch (error) {
    console.error("Erro ao criar decoração:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateDecorationPosition = async (req: AuthRequest, res: Response) => {
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

    const { company, isAdmin } = await requireCompanyAdmin(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    if (!isAdmin) {
      return res.status(403).json({ error: "Apenas administradores podem mover decorações" });
    }

    const decoration = await prisma.officeDecoration.findFirst({
      where: { id, companyId: company.id },
    });

    if (!decoration) {
      return res.status(404).json({ error: "Decoração não encontrada" });
    }

    const updated = await prisma.officeDecoration.update({
      where: { id },
      data: { x, y },
    });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("DECORATION_POSITION_UPDATED", { id: updated.id, x: updated.x, y: updated.y });
    } catch (error) {
      console.error("Erro ao emitir DECORATION_POSITION_UPDATED via socket:", error);
    }

    return res.json({ decoration: { id: updated.id, x: updated.x, y: updated.y } });
  } catch (error) {
    console.error("Erro ao atualizar posição da decoração:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateDecorationScale = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { scale } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (scale !== 1 && scale !== 2) {
      return res.status(400).json({ error: "Escala inválida" });
    }

    const { company, isAdmin } = await requireCompanyAdmin(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    if (!isAdmin) {
      return res.status(403).json({ error: "Apenas administradores podem redimensionar decorações" });
    }

    const decoration = await prisma.officeDecoration.findFirst({
      where: { id, companyId: company.id },
    });

    if (!decoration) {
      return res.status(404).json({ error: "Decoração não encontrada" });
    }

    const updated = await prisma.officeDecoration.update({
      where: { id },
      data: { scale },
    });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("DECORATION_SCALE_UPDATED", { id: updated.id, scale: updated.scale });
    } catch (error) {
      console.error("Erro ao emitir DECORATION_SCALE_UPDATED via socket:", error);
    }

    return res.json({ decoration: { id: updated.id, scale: updated.scale } });
  } catch (error) {
    console.error("Erro ao atualizar escala da decoração:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteDecoration = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { company, isAdmin } = await requireCompanyAdmin(userId);

    if (!company) {
      return res
        .status(404)
        .json({ error: "Empresa não encontrada. Crie uma empresa primeiro." });
    }

    if (!isAdmin) {
      return res.status(403).json({ error: "Apenas administradores podem remover decorações" });
    }

    const decoration = await prisma.officeDecoration.findFirst({
      where: { id, companyId: company.id },
    });

    if (!decoration) {
      return res.status(404).json({ error: "Decoração não encontrada" });
    }

    await prisma.officeDecoration.delete({ where: { id } });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`company:${company.id}`)
        .emit("DECORATION_DELETED", { id: decoration.id });
    } catch (error) {
      console.error("Erro ao emitir DECORATION_DELETED via socket:", error);
    }

    return res.json({ message: "Decoração removida com sucesso" });
  } catch (error) {
    console.error("Erro ao remover decoração:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
