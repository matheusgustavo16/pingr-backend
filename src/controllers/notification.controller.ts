import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { NotificationService } from "../services/notification.service";

export const listNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const notifications = await NotificationService.list(userId);
    return res.json({ notifications });
  } catch (error) {
    console.error("Erro ao listar notificações:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const markNotificationRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { id } = req.params;
    await NotificationService.markAsRead(userId, id);
    return res.json({ message: "Notificação marcada como lida" });
  } catch (error) {
    console.error("Erro ao marcar notificação como lida:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const markAllNotificationsRead = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    await NotificationService.markAllAsRead(userId);
    return res.json({ message: "Todas as notificações foram marcadas como lidas" });
  } catch (error) {
    console.error("Erro ao marcar notificações como lidas:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const dismissNotification = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { id } = req.params;
    await NotificationService.dismiss(userId, id);
    return res.json({ message: "Notificação removida" });
  } catch (error) {
    console.error("Erro ao remover notificação:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const clearAllNotifications = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    await NotificationService.clearAll(userId);
    return res.json({ message: "Notificações removidas" });
  } catch (error) {
    console.error("Erro ao limpar notificações:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
