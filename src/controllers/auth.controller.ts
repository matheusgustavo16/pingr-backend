import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma.service";
import {
  validateEmail,
  validatePassword,
  validateName,
} from "../utils/validation";
import { AuthRequest } from "../middleware/auth.middleware";

const JWT_SECRET = process.env.JWT_SECRET || "";

if (!JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET não configurado. Configure a variável de ambiente JWT_SECRET."
  );
}

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;

    // Validação de campos obrigatórios
    if (!name || !email || !password) {
      return res.status(400).json({
        error: "Campos obrigatórios faltando",
        details: "Nome, email e senha são obrigatórios",
      });
    }

    // Validação de nome
    const nameValidation = validateName(name);
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message });
    }

    // Validação de email
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    // Validação de senha
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message });
    }

    // Verificar se o usuário já existe
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Usuário já existe com este email" });
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
      },
    });

    // Verificar se JWT_SECRET está configurado
    if (!JWT_SECRET) {
      return res
        .status(500)
        .json({ error: "Erro de configuração do servidor" });
    }

    // Gerar token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
      token,
    });
  } catch (error: any) {
    console.error("Erro no cadastro:", error);

    // Tratar erros específicos do Prisma
    if (error.code === "P2002") {
      return res.status(400).json({ error: "Email já está em uso" });
    }

    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validação de campos obrigatórios
    if (!email || !password) {
      return res.status(400).json({ error: "Email e senha são obrigatórios" });
    }

    // Validação de email
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    // Buscar usuário com suas participações em empresas
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: {
        memberships: {
          include: {
            company: {
              select: {
                id: true,
                title: true,
                picture: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Verificar se JWT_SECRET está configurado
    if (!JWT_SECRET) {
      return res
        .status(500)
        .json({ error: "Erro de configuração do servidor" });
    }

    // Gerar token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        memberships: user.memberships.map((m) => ({
          companyId: m.companyId,
          role: m.role,
          status: m.status,
          companyName: m.company.title,
          companyPicture: m.company.picture,
        })),
      },
      token,
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    return res.json({
      user: req.user,
    });
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
