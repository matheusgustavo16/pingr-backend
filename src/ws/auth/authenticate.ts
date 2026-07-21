import { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "../../services/prisma.service";

const JWT_SECRET = process.env.JWT_SECRET || "";

export interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    name: string;
    email: string;
    picture: string | null;
    status?: string;
    roles: string[];
  };
  /** Incrementado a cada JOIN_ROOM/LEAVE_ROOM — cancela joins assíncronos
   *  que resolvem depois de um LEAVE_ROOM mais recente (ver room-manager.ts). */
  roomJoinToken?: number;
}

export const setupAuthMiddleware = async (
  socket: AuthenticatedSocket,
  next: (err?: Error) => void
) => {
  try {
    let token =
      socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.split(" ")[1];

    if (token && token.startsWith("Bearer ")) {
      token = token.split(" ")[1];
    }

    if (!token) {
      return next(new Error("Authentication error: Token not provided"));
    }

    if (!JWT_SECRET) {
      console.error("JWT_SECRET not configured");
      return next(new Error("Server configuration error"));
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
        // Adicione papéis se existirem no seu esquema Prisma
      },
    });

    if (!user) {
      return next(new Error("Authentication error: User not found"));
    }

    // Buscar o papel do usuário na empresa ativa (se houver uma companyId no handshake ou query)
    const companyId = socket.handshake.query.companyId as string;
    let roles = ["GUEST"];

    if (companyId) {
      const membership = await prisma.companyMember.findUnique({
        where: {
          userId_companyId: {
            userId: user.id,
            companyId: companyId,
          },
        },
      });

      if (!membership) {
        return next(new Error("Você não é membro deste escritório."));
      }

      if (membership.status !== "ACTIVE") {
        return next(
          new Error("Seu acesso está aguardando aprovação ou foi suspenso.")
        );
      }

      roles = [membership.role];
    }

    socket.user = {
      ...user,
      roles: roles,
    };

    next();
  } catch (error) {
    console.error("WS Auth Error:", error);
    next(new Error("Authentication error: Invalid token"));
  }
};
