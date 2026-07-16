import { prisma } from "./prisma.service";
import { WebSocketServer } from "../ws/socket-server";

export type NotificationType =
  | "MENTION"
  | "PR"
  | "DEPLOY"
  | "MEETING"
  | "TASK"
  | "MESSAGE";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  description: string;
  actionUrl?: string;
}

export class NotificationService {
  static async create(params: CreateNotificationParams) {
    const notification = await prisma.notification.create({ data: params });

    try {
      WebSocketServer.getInstance()
        .getIO()
        .to(`user:${params.userId}`)
        .emit("NOTIFICATION_NEW", notification);
    } catch (error) {
      console.error("Erro ao emitir notificação via socket:", error);
    }

    return notification;
  }

  static async createMany(paramsList: CreateNotificationParams[]) {
    return Promise.all(paramsList.map((params) => this.create(params)));
  }

  static async list(userId: string, limit = 50) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  static async markAsRead(userId: string, id: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
  }

  static async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  static async dismiss(userId: string, id: string) {
    return prisma.notification.deleteMany({ where: { id, userId } });
  }

  static async clearAll(userId: string) {
    return prisma.notification.deleteMany({ where: { userId } });
  }
}
