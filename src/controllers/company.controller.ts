import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../services/prisma.service";
import { validateName } from "../utils/validation";
import { AuthRequest } from "../middleware/auth.middleware";
import { ChatService } from "../services/chat.service";
import { GitHubService } from "../services/github.service";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { NotificationService } from "../services/notification.service";

// O JWT_SECRET deve ser lido preferencialmente dentro das funções ou garantindo que o dotenv foi carregado
const getSecret = () => process.env.JWT_SECRET || "";

export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { title, cnpj } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Validação de campos obrigatórios
    if (!title) {
      return res.status(400).json({
        error: "Nome da empresa é obrigatório",
      });
    }

    // Validação de nome
    const nameValidation = validateName(title);
    if (!nameValidation.valid) {
      return res.status(400).json({ error: nameValidation.message });
    }

    // Verificar se o usuário já tem uma empresa
    const existingCompany = await prisma.company.findFirst({
      where: { ownerId: userId },
    });

    if (existingCompany) {
      return res
        .status(400)
        .json({ error: "Você já possui uma empresa cadastrada" });
    }

    // Normalizar CNPJ: remover formatação (pontos, barras, hífens, espaços)
    const normalizedCnpj = cnpj ? cnpj.replace(/\D/g, "") : null;

    // Verificar se CNPJ já existe (se fornecido)
    if (normalizedCnpj) {
      // Validar se CNPJ tem 14 dígitos
      if (normalizedCnpj.length !== 14) {
        return res.status(400).json({ error: "CNPJ deve conter 14 dígitos" });
      }

      const cnpjExists = await prisma.company.findUnique({
        where: { cnpj: normalizedCnpj },
      });

      if (cnpjExists) {
        return res.status(400).json({ error: "CNPJ já está em uso" });
      }
    }

    // Criar empresa e já adicionar o criador como membro (Dono)
    const company = await prisma.company.create({
      data: {
        title: title.trim(),
        cnpj: normalizedCnpj,
        ownerId: userId,
        members: {
          create: {
            userId: userId,
            role: "OWNER",
            status: "ACTIVE",
          },
        },
      },
    });

    // Criar categoria padrão (Lobby)
    const lobbyCategory = await prisma.roomCategory.create({
      data: {
        title: "Lobby",
        emoji: "🏢",
        companyId: company.id,
      },
    });

    // Criar sala inicial do Auditório (fora do Lobby) — cada sala precisa de
    // um canal de chat pareado (ver ChatService.createChannelForRoom), por
    // isso usa `create` (retorna o id) em vez de `createMany`.
    const auditoriumRoom = await prisma.room.create({
      data: {
        title: "Auditório",
        companyId: company.id,
        type: "AUDITORIUM",
        categoryId: null,
      },
    });
    await ChatService.createChannelForRoom(auditoriumRoom.id);

    const room = await prisma.room.create({
      data: {
        title: "Chat Aberto",
        companyId: company.id,
        type: "CHAT",
        categoryId: lobbyCategory.id,
      }
    });
    await ChatService.createChannelForRoom(room.id);

    return res.status(201).json({
      company: {
        id: company.id,
        title: company.title,
        cnpj: company.cnpj,
        createdAt: company.createdAt,
      },
    });
  } catch (error: any) {
    console.error("Erro ao criar empresa:", error);

    // Tratar erros específicos do Prisma
    if (error.code === "P2002") {
      return res.status(400).json({ error: "CNPJ já está em uso" });
    }

    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMyCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar empresa onde o usuário é membro ATIVO ou dono
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE", // Apenas membros ativos podem acessar o dashboard
              },
            },
          },
        ],
      },
      include: {
        rooms: {
          include: { scheduledEvent: true },
        },
        decorations: true,
        categories: {
          include: {
            rooms: {
              orderBy: { order: "asc" },
              include: { scheduledEvent: true },
            },
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                picture: true,
                lastSeenAt: true,
              },
            },
          },
        },
        workspaces: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    return res.json({
      company: {
        id: company.id,
        title: company.title,
        cnpj: company.cnpj,
        picture: company.picture,
        ownerId: company.ownerId,
        createdAt: company.createdAt,
        rooms: company.rooms,
        decorations: company.decorations,
        categories: company.categories,
        workspaces: company.workspaces,
        members: company.members
          .filter((m) => m.status === "ACTIVE")
          .map((m) => ({
            id: m.id,
            userId: m.userId,
            role: m.role,
            status: m.status,
            user: {
              id: m.user.id,
              name: m.user.name,
              email: m.user.email,
              picture: m.user.picture,
              lastSeenAt: m.user.lastSeenAt,
            },
          })),
      },
    });
  } catch (error) {
    console.error("Erro ao buscar empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const createWorkspace = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { 
      title, 
      emoji, 
      githubRepoId, 
      githubRepoName, 
      githubRepoFullName, 
      githubRepoUrl 
    } = req.body as { 
      title?: string; 
      emoji?: string;
      githubRepoId?: number;
      githubRepoName?: string;
      githubRepoFullName?: string;
      githubRepoUrl?: string;
    };

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Título do projeto é obrigatório" });
    }
    if (!emoji || !emoji.trim()) {
      return res.status(400).json({ error: "Emoji do projeto é obrigatório" });
    }

    // Buscar empresa onde o usuário é membro ATIVO ou dono
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE",
              },
            },
          },
        ],
      },
      select: { id: true, title: true },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Buscar integração GitHub do usuário se houver repositório
    let githubAccessToken: string | null = null;
    if (githubRepoFullName) {
      const integration = await prisma.integration.findFirst({
        where: {
          userId,
          provider: IntegrationProvider.GITHUB,
          status: IntegrationStatus.ACTIVE,
        },
      });

      if (integration) {
        const credentials = integration.credentials as any;
        githubAccessToken = credentials?.accessToken || null;
      }
    }

    // Criar workspace, categoria e canal em uma transação
    const result = await prisma.$transaction(async (tx) => {
      // Criar workspace
      const workspace = await tx.workspace.create({
        data: {
          title: title.trim(),
          emoji: emoji.trim(),
          companyId: company.id,
          githubRepoId: githubRepoId || null,
          githubRepoName: githubRepoName || null,
          githubRepoFullName: githubRepoFullName || null,
          githubRepoUrl: githubRepoUrl || null,
        },
      });

      // Criar categoria "Notificações" automaticamente
      const category = await tx.roomCategory.create({
        data: {
          title: "Notificações",
          emoji: "🔔",
          companyId: company.id,
          workspaceId: workspace.id,
        },
      });

      // Criar canal de DEV "Atualizações" (usando tipo CHAT por enquanto)
      const room = await tx.room.create({
        data: {
          title: "Atualizações",
          companyId: company.id,
          type: "CHAT",
          categoryId: category.id,
          workspaceId: workspace.id,
        },
      });

      // Criar canal de chat para a sala
      const channel = await ChatService.createChannelForRoom(room.id, tx);

      // Criar webhook no GitHub se houver repositório e token
      let webhookId: number | null = null;
      if (githubRepoFullName && githubAccessToken) {
        try {
          const backendUrl = process.env.BACKEND_URL || process.env.FRONTEND_URL || "http://localhost:3001";
          const webhookUrl = `${backendUrl}/webhooks/github`;
          const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

          const webhook = await GitHubService.createRepositoryWebhook(
            githubAccessToken,
            githubRepoFullName.split("/")[0],
            githubRepoFullName,
            webhookUrl,
            webhookSecret
          );

          webhookId = webhook.id;

          // Atualizar workspace com webhookId
          await tx.workspace.update({
            where: { id: workspace.id },
            data: { githubWebhookId: webhookId },
          });
        } catch (error: any) {
          console.error("Erro ao criar webhook do GitHub:", error);
          // Não falhar a criação do workspace se o webhook falhar
        }
      }

      return { workspace: { ...workspace, githubWebhookId: webhookId }, category, room, channel };
    });

    return res.status(201).json({ 
      workspace: result.workspace,
      category: result.category,
      room: result.room,
    });
  } catch (error) {
    console.error("Erro ao criar workspace:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateWorkspace = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { workspaceId } = req.params;
    const { title, emoji } = req.body as { title?: string; emoji?: string };

    if (!workspaceId) {
      return res.status(400).json({ error: "ID da workspace é obrigatório" });
    }

    // Buscar empresa onde o usuário é membro ATIVO ou dono
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE",
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se a workspace pertence à empresa
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        companyId: company.id,
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace não encontrada" });
    }

    // Atualizar workspace
    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(title && { title: title.trim() }),
        ...(emoji && { emoji: emoji.trim() }),
      },
    });

    return res.json({ workspace: updated });
  } catch (error) {
    console.error("Erro ao atualizar workspace:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteWorkspace = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { workspaceId } = req.params;

    if (!workspaceId) {
      return res.status(400).json({ error: "ID da workspace é obrigatório" });
    }

    // Buscar empresa onde o usuário é membro ATIVO ou dono
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE",
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se a workspace pertence à empresa e buscar dados para deletar webhook
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        companyId: company.id,
      },
      include: {
        rooms: {
          include: {
            chatChannel: true,
          },
        },
      },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace não encontrada" });
    }

    // Deletar webhook do GitHub se existir
    if (workspace.githubWebhookId && workspace.githubRepoFullName) {
      try {
        // Buscar integração GitHub do usuário
        const integration = await prisma.integration.findFirst({
          where: {
            userId,
            provider: IntegrationProvider.GITHUB,
            status: IntegrationStatus.ACTIVE,
          },
        });

        if (integration) {
          const credentials = integration.credentials as any;
          const accessToken = credentials?.accessToken;

          if (accessToken) {
            await GitHubService.deleteRepositoryWebhook(
              accessToken,
              workspace.githubRepoFullName!.split("/")[0],
              workspace.githubRepoFullName!,
              workspace.githubWebhookId
            );
          }
        }
      } catch (error: any) {
        console.error("Erro ao deletar webhook do GitHub:", error);
        // Continuar mesmo se falhar
      }
    }

    // Deletar workspace e todo conteúdo relacionado em uma transação
    // O Prisma vai deletar em cascata: rooms -> chatChannels -> messages, etc.
    await prisma.workspace.delete({
      where: { id: workspaceId },
    });

    return res.json({ message: "Workspace deletada com sucesso" });
  } catch (error) {
    console.error("Erro ao deletar workspace:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getPublicCompanyInfo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        picture: true,
        _count: {
          select: { members: true },
        },
      },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se o usuário já tem uma relação com esta empresa (opcional)
    let membership = null;
    const authHeader = req.headers.authorization;
    const secret = getSecret();

    if (authHeader && secret) {
      try {
        const token = (authHeader as string).startsWith("Bearer ")
          ? (authHeader as string).substring(7)
          : (authHeader as string);

        const decoded = jwt.verify(token, secret) as any;
        const userId = decoded?.userId;

        if (userId) {
          membership = await prisma.companyMember.findFirst({
            where: {
              userId: userId,
              companyId: id,
            },
            select: { status: true, role: true },
          });
        }
      } catch (e) {
        console.error("Token verification failed in public route:", e);
      }
    }

    return res.json({
      company: {
        id: company.id,
        title: company.title,
        picture: company.picture,
        memberCount: company._count.members,
      },
      membership,
    });
  } catch (error) {
    console.error("Erro ao buscar info pública da empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const joinCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id: companyId } = req.params;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Verificar se a empresa existe
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se já é membro
    const existingMembership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (existingMembership) {
      return res.status(400).json({ error: "Você já é membro desta empresa" });
    }

    // Adicionar como membro com status PENDING
    const membership = await prisma.companyMember.create({
      data: {
        userId,
        companyId,
        role: "MEMBER",
        status: "PENDING",
      },
    });

    // Notificar owner/admins da empresa sobre a solicitação
    try {
      const requester = await prisma.user.findUnique({ where: { id: userId } });
      const approvers = await prisma.companyMember.findMany({
        where: { companyId, role: { in: ["OWNER", "ADMIN"] } },
        select: { userId: true },
      });

      await NotificationService.createMany(
        approvers.map((a) => ({
          userId: a.userId,
          type: "TASK" as const,
          title: "Nova solicitação de entrada",
          description: `${requester?.name || "Alguém"} quer entrar em ${company.title}`,
          actionUrl: "/office/members",
        }))
      );
    } catch (error) {
      console.error("Erro ao notificar solicitação de entrada:", error);
    }

    return res.status(201).json({
      message: "Solicitação enviada! Aguarde a aprovação de um administrador.",
      membership,
    });
  } catch (error) {
    console.error("Erro ao entrar na empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getMembers = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id: companyId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Verificar se o usuário tem permissão para ver membros (ADMIN ou OWNER)
    const requester = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (
      !requester ||
      (requester.role !== "OWNER" && requester.role !== "ADMIN")
    ) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const members = await prisma.companyMember.findMany({
      where: { companyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            picture: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ members });
  } catch (error) {
    console.error("Erro ao buscar membros:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateMemberStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { id: companyId, memberId } = req.params;
    const { status, role } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Verificar se o requerente é ADMIN ou OWNER
    const requester = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (
      !requester ||
      (requester.role !== "OWNER" && requester.role !== "ADMIN")
    ) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const previousMember = await prisma.companyMember.findUnique({
      where: { id: memberId },
    });

    const updatedMember = await prisma.companyMember.update({
      where: { id: memberId },
      data: {
        status,
        role,
      },
    });

    // Notificar o membro se foi aprovado agora (PENDING -> ACTIVE)
    if (previousMember?.status === "PENDING" && updatedMember.status === "ACTIVE") {
      try {
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        await NotificationService.create({
          userId: updatedMember.userId,
          type: "TASK",
          title: "Solicitação aprovada",
          description: `Você agora faz parte de ${company?.title || "empresa"}`,
          actionUrl: "/office",
        });
      } catch (error) {
        console.error("Erro ao notificar aprovação de membro:", error);
      }
    }

    return res.json({
      message: "Membro atualizado com sucesso",
      member: updatedMember,
    });
  } catch (error) {
    console.error("Erro ao atualizar membro:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const updateCompany = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar empresa do usuário
    const company = await prisma.company.findFirst({
      where: { ownerId: req.userId },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se o usuário é o dono
    if (company.ownerId !== req.userId) {
      return res.status(403).json({ error: "Apenas o dono pode atualizar a empresa" });
    }

    const { title, cnpj } = req.body;

    // Preparar dados para atualização
    const updateData: { title?: string; cnpj?: string | null } = {};

    if (title !== undefined) {
      const nameValidation = validateName(title);
      if (!nameValidation.valid) {
        return res.status(400).json({ error: nameValidation.message });
      }
      updateData.title = title.trim();
    }

    if (cnpj !== undefined) {
      if (cnpj === null || cnpj === "") {
        updateData.cnpj = null;
      } else {
        // Normalizar CNPJ: remover formatação
        const normalizedCnpj = cnpj.replace(/\D/g, "");

        // Validar se CNPJ tem 14 dígitos
        if (normalizedCnpj.length !== 14) {
          return res.status(400).json({ error: "CNPJ deve conter 14 dígitos" });
        }

        // Verificar se CNPJ já existe em outra empresa
        const cnpjExists = await prisma.company.findFirst({
          where: {
            cnpj: normalizedCnpj,
            id: { not: company.id },
          },
        });

        if (cnpjExists) {
          return res.status(400).json({ error: "CNPJ já está em uso" });
        }

        updateData.cnpj = normalizedCnpj;
      }
    }

    const updatedCompany = await prisma.company.update({
      where: { id: company.id },
      data: updateData,
      select: {
        id: true,
        title: true,
        cnpj: true,
        picture: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return res.json({
      company: updatedCompany,
    });
  } catch (error) {
    console.error("Erro ao atualizar empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const leaveCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    // Buscar empresa do usuário
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
                status: "ACTIVE",
              },
            },
          },
        ],
      },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se o usuário é o dono
    if (company.ownerId === userId) {
      return res.status(400).json({
        error: "O dono da empresa não pode sair. Transfira a propriedade primeiro ou delete a empresa.",
      });
    }

    // Remover membro da empresa
    await prisma.companyMember.deleteMany({
      where: {
        userId,
        companyId: company.id,
      },
    });

    return res.json({
      message: "Você saiu da empresa com sucesso",
    });
  } catch (error) {
    console.error("Erro ao sair da empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const uploadCompanyLogo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    // Buscar empresa do usuário
    const company = await prisma.company.findFirst({
      where: { ownerId: req.userId },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se o usuário é o dono
    if (company.ownerId !== req.userId) {
      return res.status(403).json({ error: "Apenas o dono pode atualizar o logo" });
    }

    // Importar serviço Cloudinary
    const { uploadImage, extractPublicIdFromUrl, deleteImage } = await import(
      "../services/cloudinary.service"
    );

    // Fazer upload da nova imagem
    const uploadResult = await uploadImage(
      req.file.buffer,
      "company-logos",
      company.id
    );

    // Atualizar empresa com nova URL da imagem
    const updatedCompany = await prisma.company.update({
      where: { id: company.id },
      data: { picture: uploadResult.url },
      select: {
        id: true,
        title: true,
        cnpj: true,
        picture: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Deletar imagem antiga do Cloudinary se existir
    if (company.picture) {
      const oldPublicId = extractPublicIdFromUrl(company.picture);
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
      company: updatedCompany,
    });
  } catch (error) {
    console.error("Erro ao fazer upload do logo:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};