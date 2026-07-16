import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { prisma } from "../services/prisma.service";
import { WebSocketServer } from "../ws/socket-server";
import { presenceService } from "../ws/presence/presence-service";
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
      select: {
        id: true,
        name: true,
        email: true,
        password: true,
        picture: true,
        status: true,
        memberships: {
          select: {
            companyId: true,
            role: true,
            status: true,
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

    // Atualizar status para AVAILABLE ao fazer login (se não estiver definido)
    // e registrar último acesso
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastSeenAt: new Date(),
        ...(!user.status ? { status: "AVAILABLE" as const } : {}),
      },
    });
    if (!user.status) {
      user.status = "AVAILABLE";
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
        status: user.status,
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

export const createGuest = async (req: Request, res: Response) => {
  try {
    const { name } = req.body as { name?: string };

    // Validação simples de nome (mesma regra do cadastro)
    const guestName = (name || "").trim();
    const nameValidation = validateName(guestName);
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message });
    }

    if (!JWT_SECRET) {
      return res
        .status(500)
        .json({ error: "Erro de configuração do servidor" });
    }

    // Criar usuário "visitante" sem senha e sem memberships.
    // Email precisa ser único, então geramos um identificador.
    const guestId = randomUUID();
    const email = `guest_${guestId}@pingr.local`;

    const user = await prisma.user.create({
      data: {
        name: guestName,
        email,
        password: null,
        status: "AVAILABLE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
      },
    });

    // Token curto: visitante só deve usar para entrar na call via link.
    const token = jwt.sign(
      { userId: user.id, guest: true },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        picture: user.picture,
        status: user.status,
        isGuest: true,
      },
      token,
    });
  } catch (error: any) {
    console.error("Erro ao criar visitante:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
        locale: true,
        preferences: true,
        memberships: {
          select: {
            companyId: true,
            role: true,
            status: true,
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

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res.json({
      user: {
        ...user,
        memberships: user.memberships.map((m) => ({
          companyId: m.companyId,
          role: m.role,
          status: m.status,
          companyName: m.company.title,
          companyPicture: m.company.picture,
        })),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { status } = req.body;

    // Validar status
    const validStatuses = [
      "AVAILABLE",
      "BUSY",
      "IN_MEETING",
      "AWAY",
      "FOCUS",
      "CODING",
      "REVIEWING",
    ];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: "Status inválido",
        validStatuses,
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
      },
    });

    // Atualizar presença e notificar via websocket (atualização instantânea no mapa)
    try {
      const presence = presenceService.getPresence(req.userId);
      presenceService.updatePresence(req.userId, {
        userStatus: updatedUser.status,
      });

      const io = WebSocketServer.getInstance().getIO();
      const payload = {
        userId: req.userId,
        status: updatedUser.status,
      };

      // Broadcast global (para atualizar UIs diversas)
      io.emit("USER_STATUS_CHANGED", payload);

      // Se estiver em uma sala, também emitir na sala (útil para filtros)
      if (presence?.currentRoomId) {
        io.to(presence.currentRoomId).emit("USER_STATUS_CHANGED", payload);
      }
    } catch (e) {
      // Se WS não estiver inicializado, não falhar a request
      console.warn("WS broadcast failed on updateStatus:", e);
    }

    return res.json({
      user: updatedUser,
    });
  } catch (error) {
    console.error("Erro ao atualizar status:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Atualiza locale e/ou preferências (notificações, privacidade, região) do usuário.
 * O merge é feito por namespace (ex: "notifications", "privacy", "region") para
 * permitir atualizar um campo isolado sem apagar os demais daquele namespace.
 */
export const updatePreferences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { locale, preferences } = req.body as {
      locale?: string;
      preferences?: Record<string, Record<string, unknown>>;
    };

    const existingUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { preferences: true },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const currentPreferences = (existingUser.preferences as Record<string, any>) || {};
    let mergedPreferences = currentPreferences;

    if (preferences && typeof preferences === "object") {
      mergedPreferences = { ...currentPreferences };
      for (const namespace of Object.keys(preferences)) {
        mergedPreferences[namespace] = {
          ...(currentPreferences[namespace] || {}),
          ...preferences[namespace],
        };
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(locale ? { locale } : {}),
        preferences: mergedPreferences,
      },
      select: {
        id: true,
        name: true,
        email: true,
        picture: true,
        status: true,
        locale: true,
        preferences: true,
      },
    });

    return res.json({ user: updatedUser });
  } catch (error) {
    console.error("Erro ao atualizar preferências:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { name } = req.body;

    // Validação de nome
    if (name !== undefined) {
      const nameValidation = validateName(name);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.message });
      }
    }

    // Preparar dados para atualização
    const updateData: { name?: string } = {};
    if (name !== undefined) {
      updateData.name = name.trim();
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: updateData,
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

    return res.json({
      user: {
        ...updatedUser,
        memberships: updatedUser.memberships.map((m) => ({
          companyId: m.companyId,
          role: m.role,
          status: m.status,
          companyName: m.company.title,
          companyPicture: m.company.picture,
        })),
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Senha é obrigatória" });
    }

    // Buscar usuário com senha
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user || !user.password) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Verificar senha
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    // Verificar se o usuário é dono de alguma empresa
    const ownedCompany = await prisma.company.findFirst({
      where: { ownerId: req.userId },
    });

    if (ownedCompany) {
      return res.status(400).json({
        error: "Você é dono de uma empresa. Transfira a propriedade ou delete a empresa antes de deletar sua conta.",
      });
    }

    // Deletar todas as relações do usuário
    await prisma.$transaction(async (tx) => {
      // Deletar membros de empresas
      await tx.companyMember.deleteMany({
        where: { userId: req.userId },
      });

      // Deletar usuário (cascata deve deletar outras relações)
      await tx.user.delete({
        where: { id: req.userId },
      });
    });

    return res.json({
      message: "Conta deletada com sucesso",
    });
  } catch (error) {
    console.error("Erro ao deletar conta:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updatePassword = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Senha atual e nova senha são obrigatórias",
      });
    }

    // Buscar usuário com senha
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        password: true,
      },
    });

    if (!user || !user.password) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Verificar senha atual
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Senha atual incorreta" });
    }

    // Validar nova senha
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message });
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualizar senha
    await prisma.user.update({
      where: { id: req.userId },
      data: { password: hashedPassword },
    });

    return res.json({
      message: "Senha atualizada com sucesso",
    });
  } catch (error) {
    console.error("Erro ao atualizar senha:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getTwoFactorStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const twoFactor = await prisma.twoFactor.findFirst({
      where: {
        userId: req.userId,
        pending: false,
      },
      select: {
        id: true,
        type: true,
        createdAt: true,
      },
    });

    return res.json({
      enabled: !!twoFactor,
      type: twoFactor?.type || null,
      createdAt: twoFactor?.createdAt || null,
    });
  } catch (error) {
    console.error("Erro ao buscar status do 2FA:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const enableTwoFactor = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { secret, code } = req.body;

    if (!secret || !code) {
      return res.status(400).json({
        error: "Secret e código são obrigatórios",
      });
    }

    // TODO: Validar código TOTP
    // Por enquanto, vamos apenas criar o registro
    // Em produção, você deve validar o código usando uma biblioteca como 'speakeasy'

    const twoFactor = await prisma.twoFactor.create({
      data: {
        userId: req.userId,
        type: "TOTP",
        secretEnc: secret, // Em produção, deve ser encriptado
        authTag: "",
        pending: false,
      },
    });

    return res.json({
      message: "Autenticação de dois fatores ativada com sucesso",
      twoFactor: {
        id: twoFactor.id,
        type: twoFactor.type,
      },
    });
  } catch (error) {
    console.error("Erro ao ativar 2FA:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const disableTwoFactor = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Senha é obrigatória" });
    }

    // Verificar senha
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { password: true },
    });

    if (!user || !user.password) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    // Deletar todos os registros de 2FA do usuário
    await prisma.twoFactor.deleteMany({
      where: { userId: req.userId },
    });

    return res.json({
      message: "Autenticação de dois fatores desativada com sucesso",
    });
  } catch (error) {
    console.error("Erro ao desativar 2FA:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getSessions = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Por enquanto, vamos retornar sessões mockadas
    // Em produção, você deve armazenar sessões no banco de dados
    // e rastrear tokens JWT emitidos

    const sessions = [
      {
        id: "1",
        device: "Chrome no Windows",
        location: "São Paulo, Brasil",
        lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 horas atrás
        current: true,
      },
    ];

    return res.json({ sessions });
  } catch (error) {
    console.error("Erro ao buscar sessões:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const revokeSession = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { sessionId } = req.params;

    // Por enquanto, apenas retornamos sucesso
    // Em produção, você deve invalidar o token JWT correspondente

    return res.json({
      message: "Sessão encerrada com sucesso",
    });
  } catch (error) {
    console.error("Erro ao encerrar sessão:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    // Importar serviço Cloudinary
    const { uploadImage, extractPublicIdFromUrl, deleteImage } = await import(
      "../services/cloudinary.service"
    );

    // Buscar usuário atual para obter a imagem antiga
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { picture: true },
    });

    // Fazer upload da nova imagem
    const uploadResult = await uploadImage(
      req.file.buffer,
      "avatars",
      req.userId
    );

    // Atualizar usuário com nova URL da imagem
    const updatedUser = await prisma.user.update({
      where: { id: req.userId },
      data: { picture: uploadResult.url },
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

    // Deletar imagem antiga do Cloudinary se existir
    if (currentUser?.picture) {
      const oldPublicId = extractPublicIdFromUrl(currentUser.picture);
      if (oldPublicId) {
        try {
          await deleteImage(oldPublicId);
        } catch (error) {
          console.error("Erro ao deletar imagem antiga:", error);
          // Não falhar a requisição se não conseguir deletar
        }
      }
    }

    return res.json({
      user: {
        ...updatedUser,
        memberships: updatedUser.memberships.map((m) => ({
          companyId: m.companyId,
          role: m.role,
          status: m.status,
          companyName: m.company.title,
          companyPicture: m.company.picture,
        })),
      },
    });
  } catch (error) {
    console.error("Erro ao fazer upload do avatar:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};