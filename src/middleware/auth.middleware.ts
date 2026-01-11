import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma.service";

const JWT_SECRET = process.env.JWT_SECRET || "";

export interface AuthRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    picture?: string | null;
    status?: string;
    memberships?: Array<{
      companyId: string;
      role: string;
      status: string;
    }>;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ error: "Token não fornecido" });
      return;
    }

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7)
      : authHeader;

    if (!token) {
      res.status(401).json({ error: "Token não fornecido" });
      return;
    }

    if (!JWT_SECRET) {
      console.error("JWT_SECRET não configurado");
      res.status(500).json({ error: "Erro de configuração do servidor" });
      return;
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
        memberships: {
          select: {
            companyId: true,
            role: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: "Usuário não encontrado" });
      return;
    }

    req.userId = user.id;
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Token inválido" });
      return;
    }
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expirado" });
      return;
    }
    console.error("Erro na autenticação:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};
