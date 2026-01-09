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

// Armazenamento temporário de códigos 2FA (em memória - para desenvolvimento)
// Em produção, isso deve ser armazenado em Redis ou banco de dados
interface TwoFactorData {
  userId: string;
  code: string;
  expiresAt: Date;
}

const twoFactorCodes = new Map<string, TwoFactorData>();

// Limpar códigos expirados periodicamente
setInterval(() => {
  const now = new Date();
  for (const [key, data] of twoFactorCodes.entries()) {
    if (data.expiresAt < now) {
      twoFactorCodes.delete(key);
    }
  }
}, 60000); // Limpar a cada minuto

// Gerar código 2FA de 6 dígitos
function generateTwoFactorCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user || !user.password) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    // Gerar código 2FA fictício
    const twoFactorCode = generateTwoFactorCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expira em 10 minutos

    // Armazenar código temporariamente
    twoFactorCodes.set(user.id, {
      userId: user.id,
      code: twoFactorCode,
      expiresAt,
    });

    // Retornar código 2FA (em produção, isso seria enviado por email/SMS)
    return res.json({
      message: "Código 2FA gerado",
      twoFactorCode, // Apenas para desenvolvimento - em produção não enviar
      expiresIn: 600, // 10 minutos em segundos
    });
  } catch (error) {
    console.error("Erro no login:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const verifyTwoFactor = async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;

    // Validação de campos obrigatórios
    if (!email || !code) {
      return res.status(400).json({ error: "Email e código são obrigatórios" });
    }

    // Validação de email
    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }

    // Validação de código (deve ter 6 dígitos)
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Código deve ter 6 dígitos" });
    }

    // Buscar usuário
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    // Buscar código 2FA armazenado
    const storedData = twoFactorCodes.get(user.id);

    if (!storedData) {
      return res
        .status(401)
        .json({
          error: "Código 2FA não encontrado ou expirado. Faça login novamente.",
        });
    }

    // Verificar se o código expirou
    if (storedData.expiresAt < new Date()) {
      twoFactorCodes.delete(user.id);
      return res
        .status(401)
        .json({ error: "Código 2FA expirado. Faça login novamente." });
    }

    // Verificar código
    if (storedData.code !== code) {
      return res.status(401).json({ error: "Código 2FA inválido" });
    }

    // Verificar se JWT_SECRET está configurado
    if (!JWT_SECRET) {
      return res
        .status(500)
        .json({ error: "Erro de configuração do servidor" });
    }

    // Remover código usado
    twoFactorCodes.delete(user.id);

    // Gerar token JWT
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
      },
      token,
    });
  } catch (error) {
    console.error("Erro na verificação 2FA:", error);
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
