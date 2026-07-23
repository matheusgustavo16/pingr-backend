import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { prisma } from "../services/prisma.service";
import { validateName, validateEmail } from "../utils/validation";
import { AuthRequest } from "../middleware/auth.middleware";
import { ChatService } from "../services/chat.service";
import { GitHubService } from "../services/github.service";
import { EmailService } from "../services/email.service";
import { IntegrationProvider, IntegrationStatus } from "@prisma/client";
import { NotificationService } from "../services/notification.service";
import { cacheGetJSON, cacheSetJSON } from "../services/cache/app-cache";
import { listUserCompanies, isUserInCompany } from "../services/company.service";

const INVITE_EXPIRATION_DAYS = 7;

const COMPANY_SECTOR_OPTIONS = [
  "Tecnologia",
  "Saúde",
  "Educação",
  "Finanças",
  "Varejo e Comércio",
  "Indústria",
  "Agronegócio",
  "Construção Civil",
  "Alimentação",
  "Turismo e Hospitalidade",
  "Transporte e Logística",
  "Marketing e Publicidade",
  "Jurídico",
  "Consultoria",
  "Imobiliário",
  "Energia",
  "Telecomunicações",
  "Entretenimento",
  "ONG e Terceiro Setor",
  "Governo e Setor Público",
  "Outro",
];

// TTL curto de propósito: getMyCompany é compartilhado por todos os membros
// da company (mesmo payload pra todo mundo), então cache por companyId ganha
// muito em tráfego real sem ficar stale por muito tempo. Sem invalidação
// ativa nos endpoints de mutation — TTL sozinho já é menor que o
// staleTime (60s) do react-query no client.
const MY_COMPANY_CACHE_TTL_SECONDS = 15;

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

    // Empresa ativa já resolvida e revalidada (dono ou membro ATIVO) pelo
    // middleware de autenticação a cada request — não precisa reconsultar aqui.
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const cacheKey = `mycompany:${companyId}`;
    const cached = await cacheGetJSON<Record<string, unknown>>(cacheKey);
    if (cached) {
      return res.json({ company: cached });
    }

    // Payload pesado (rooms/categories/members/workspaces aninhados) é igual
    // pra qualquer membro dessa company — cacheável e compartilhável entre
    // usuários. relationLoadStrategy "join" colapsa os includes aninhados
    // numa única query SQL (LATERAL JOIN) em vez de N queries sequenciais.
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      relationLoadStrategy: "join",
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

    const payload = {
      id: company.id,
      title: company.title,
      cnpj: company.cnpj,
      picture: company.picture,
      description: company.description,
      website: company.website,
      sector: company.sector,
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
    };

    cacheSetJSON(cacheKey, payload, MY_COMPANY_CACHE_TTL_SECONDS).catch(() => {});

    return res.json({ company: payload });
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

    // Empresa ativa já resolvida e revalidada pelo middleware de autenticação
    const companyId = req.companyId;

    if (!companyId) {
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
          companyId,
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
          companyId,
          workspaceId: workspace.id,
        },
      });

      // Criar canal de DEV "Atualizações" (usando tipo CHAT por enquanto)
      const room = await tx.room.create({
        data: {
          title: "Atualizações",
          companyId,
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
    const companyId = req.companyId;

    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se a workspace pertence à empresa
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        companyId,
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

    const companyId = req.companyId;

    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    // Verificar se a workspace pertence à empresa e buscar dados para deletar webhook
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        companyId,
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

/**
 * Envia convites por e-mail para pessoas entrarem na empresa do usuário autenticado.
 * Apenas OWNER/ADMIN podem convidar. Idempotente por (companyId, email): reenviar
 * gera um novo token e reseta o prazo de expiração.
 */
export const inviteMembers = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { emails } = req.body as { emails?: string[] };
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "Informe ao menos um e-mail" });
    }

    const companyId = req.companyId;

    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, title: true, picture: true },
    });

    if (!company) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const requester = await prisma.companyMember.findUnique({
      where: { userId_companyId: { userId, companyId: company.id } },
    });

    if (!requester || (requester.role !== "OWNER" && requester.role !== "ADMIN")) {
      return res.status(403).json({ error: "Apenas donos e administradores podem convidar" });
    }

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const uniqueEmails = Array.from(
      new Set(emails.map((e) => (typeof e === "string" ? e.toLowerCase().trim() : "")))
    ).filter(Boolean);

    const results: Array<{ email: string; status: "sent" | "already_member" | "invalid" | "error" }> = [];

    for (const email of uniqueEmails) {
      if (!validateEmail(email)) {
        results.push({ email, status: "invalid" });
        continue;
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        const existingMembership = await prisma.companyMember.findUnique({
          where: { userId_companyId: { userId: existingUser.id, companyId: company.id } },
        });
        if (existingMembership && existingMembership.status === "ACTIVE") {
          results.push({ email, status: "already_member" });
          continue;
        }
      }

      try {
        const token = randomBytes(24).toString("hex");
        const expiresAt = new Date(Date.now() + INVITE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

        await prisma.companyInvite.upsert({
          where: { companyId_email: { companyId: company.id, email } },
          update: { token, status: "PENDING", expiresAt, acceptedAt: null, invitedById: userId },
          create: {
            email,
            token,
            expiresAt,
            companyId: company.id,
            invitedById: userId,
          },
        });

        await EmailService.sendCompanyInvite({
          to: email,
          companyName: company.title,
          inviterName: inviter?.name || "Alguém",
          acceptUrl: `${frontendUrl}/invite/accept/${token}`,
        });

        results.push({ email, status: "sent" });
      } catch (error) {
        console.error(`Erro ao convidar ${email}:`, error);
        results.push({ email, status: "error" });
      }
    }

    return res.json({ results });
  } catch (error) {
    console.error("Erro ao enviar convites:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Info pública de um convite (usada na página de aceite antes do login/cadastro).
 */
export const getInviteInfo = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const invite = await prisma.companyInvite.findUnique({
      where: { token },
      include: { company: { select: { title: true, picture: true } } },
    });

    if (!invite) {
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    let status = invite.status;
    if (status === "PENDING" && invite.expiresAt < new Date()) {
      status = "EXPIRED";
      await prisma.companyInvite.update({ where: { token }, data: { status: "EXPIRED" } });
    }

    return res.json({
      invite: {
        email: invite.email,
        status,
        companyName: invite.company.title,
        companyPicture: invite.company.picture,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar convite:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Aceita um convite: o usuário autenticado precisa ter o mesmo e-mail para o
 * qual o convite foi enviado. Cria/ativa o CompanyMember correspondente.
 */
export const acceptInvite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { token } = req.params;
    const invite = await prisma.companyInvite.findUnique({
      where: { token },
      include: { company: { select: { id: true, title: true, picture: true } } },
    });

    if (!invite) {
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    if (invite.status === "ACCEPTED") {
      return res.status(400).json({ error: "Este convite já foi utilizado" });
    }
    if (invite.status === "REVOKED") {
      return res.status(400).json({ error: "Este convite foi revogado" });
    }
    if (invite.status === "EXPIRED" || invite.expiresAt < new Date()) {
      await prisma.companyInvite.update({ where: { token }, data: { status: "EXPIRED" } });
      return res.status(400).json({ error: "Este convite expirou" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return res.status(403).json({
        error: `Este convite foi enviado para ${invite.email}. Entre com essa conta para aceitar.`,
      });
    }

    await prisma.companyMember.upsert({
      where: { userId_companyId: { userId, companyId: invite.companyId } },
      update: { status: "ACTIVE" },
      create: { userId, companyId: invite.companyId, role: invite.role, status: "ACTIVE" },
    });

    await prisma.companyInvite.update({
      where: { token },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    try {
      await NotificationService.create({
        userId: invite.invitedById,
        type: "TASK",
        title: "Convite aceito",
        description: `${user.email} entrou em ${invite.company.title}`,
        actionUrl: "/office/members",
      });
    } catch (error) {
      console.error("Erro ao notificar aceite de convite:", error);
    }

    return res.json({
      company: { id: invite.company.id, title: invite.company.title, picture: invite.company.picture },
    });
  } catch (error) {
    console.error("Erro ao aceitar convite:", error);
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

    const { title, cnpj, description, website, sector } = req.body;

    // Preparar dados para atualização
    const updateData: {
      title?: string;
      cnpj?: string | null;
      description?: string | null;
      website?: string | null;
      sector?: string | null;
    } = {};

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

    if (description !== undefined) {
      const trimmed = description === null ? null : String(description).trim();
      if (trimmed && trimmed.length > 500) {
        return res.status(400).json({ error: "Descrição deve ter no máximo 500 caracteres" });
      }
      updateData.description = trimmed || null;
    }

    if (website !== undefined) {
      const trimmed = website === null ? null : String(website).trim();
      if (trimmed && !/^https?:\/\/.+\..+/.test(trimmed)) {
        return res.status(400).json({ error: "Website deve ser uma URL válida (ex: https://exemplo.com)" });
      }
      updateData.website = trimmed || null;
    }

    if (sector !== undefined) {
      const trimmed = sector === null ? null : String(sector).trim();
      if (trimmed && !COMPANY_SECTOR_OPTIONS.includes(trimmed)) {
        return res.status(400).json({ error: "Setor inválido" });
      }
      updateData.sector = trimmed || null;
    }

    const updatedCompany = await prisma.company.update({
      where: { id: company.id },
      data: updateData,
      select: {
        id: true,
        title: true,
        cnpj: true,
        picture: true,
        description: true,
        website: true,
        sector: true,
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

    const companyId = req.companyId;

    if (!companyId) {
      return res.status(404).json({ error: "Empresa não encontrada" });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, ownerId: true },
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

/**
 * Lista as empresas do usuário autenticado (dono ou membro ativo),
 * marcando qual delas é a empresa ativa da sessão atual.
 */
export const listCompanies = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const companies = await listUserCompanies(userId);

    return res.json({
      companies: companies.map((company) => ({
        ...company,
        active: company.id === req.companyId,
      })),
    });
  } catch (error) {
    console.error("Erro ao listar empresas:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

/**
 * Troca a empresa ativa da sessão: valida que o usuário é dono/membro ativo
 * da empresa alvo e reemite o JWT com a nova claim `companyId`.
 */
export const switchCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const { companyId } = req.body as { companyId?: string };
    if (!companyId) {
      return res.status(400).json({ error: "companyId é obrigatório" });
    }

    const company = await isUserInCompany(userId, companyId);
    if (!company) {
      return res
        .status(403)
        .json({ error: "Você não pertence a esta empresa" });
    }

    const secret = getSecret();
    if (!secret) {
      console.error("JWT_SECRET não configurado");
      return res.status(500).json({ error: "Erro de configuração do servidor" });
    }

    const token = jwt.sign({ userId, companyId: company.id }, secret, {
      expiresIn: "7d",
    });

    return res.json({
      token,
      company: { id: company.id, title: company.title, picture: company.picture },
    });
  } catch (error) {
    console.error("Erro ao trocar de empresa:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};