import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { prisma } from "../services/prisma.service";
import { GitHubService } from "../services/github.service";
import { GoogleCalendarService } from "../services/google-calendar.service";
import { IntegrationProvider, IntegrationStatus, Prisma } from "@prisma/client";

/**
 * Inicia o fluxo OAuth do GitHub
 * Retorna a URL de autorização
 */
export const initiateGitHubOAuth = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const state = Buffer.from(req.userId).toString("base64");
    const authUrl = GitHubService.getAuthorizationUrl(state);

    return res.json({ authUrl });
  } catch (error: any) {
    console.error("Erro ao iniciar OAuth do GitHub:", error);
    return res.status(500).json({
      error: "Erro ao iniciar autenticação do GitHub",
      details: error.message,
    });
  }
};

/**
 * Callback do OAuth do GitHub
 * Recebe o código de autorização e salva o token
 * Não requer autenticação - o GitHub chama diretamente
 */
export const handleGitHubCallback = async (
  req: Request,
  res: Response
) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Código de autorização não fornecido" });
    }

    // Decodificar o state para obter o userId
    let userId: string;
    try {
      userId = Buffer.from(state as string, "base64").toString("utf-8");
    } catch {
      return res.status(400).json({ error: "State inválido" });
    }

    // Verificar se o usuário existe
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Trocar código por token
    const accessToken = await GitHubService.exchangeCodeForToken(code);

    // Obter informações do usuário do GitHub
    const githubUser = await GitHubService.getUserInfo(accessToken);

    // Salvar ou atualizar a integração
    const integration = await prisma.integration.upsert({
      where: {
        provider_externalId_userId: {
          provider: IntegrationProvider.GITHUB,
          externalId: githubUser.id.toString(),
          userId: userId,
        },
      },
      update: {
        status: IntegrationStatus.ACTIVE,
        connectedAt: new Date(),
        credentials: {
          accessToken,
          githubUserId: githubUser.id,
          githubUsername: githubUser.login,
        },
        config: {
          name: githubUser.name || githubUser.login,
          avatar: githubUser.avatar_url,
        },
        revokedAt: null,
      },
      create: {
        provider: IntegrationProvider.GITHUB,
        name: githubUser.name || githubUser.login,
        description: `Conta GitHub: ${githubUser.login}`,
        status: IntegrationStatus.ACTIVE,
        connectedAt: new Date(),
        externalId: githubUser.id.toString(),
        externalUrl: `https://github.com/${githubUser.login}`,
        credentials: {
          accessToken,
          githubUserId: githubUser.id,
          githubUsername: githubUser.login,
        },
        config: {
          name: githubUser.name || githubUser.login,
          avatar: githubUser.avatar_url,
        },
        userId: userId,
      },
    });

    // Redirecionar para a página de configurações com sucesso
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(`${frontendUrl}/settings?section=integrations&integration=github&status=connected`);
  } catch (error: any) {
    console.error("Erro no callback do GitHub:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(
      `${frontendUrl}/settings?section=integrations&integration=github&status=error&message=${encodeURIComponent(error.message)}`
    );
  }
};

/**
 * Lista os repositórios do usuário conectado ao GitHub
 */
export const listGitHubRepositories = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    // Buscar a integração ativa do GitHub
    const integration = await prisma.integration.findFirst({
      where: {
        userId: req.userId,
        provider: IntegrationProvider.GITHUB,
        status: IntegrationStatus.ACTIVE,
      },
    });

    if (!integration) {
      return res.status(404).json({
        error: "Integração do GitHub não encontrada",
        connected: false,
      });
    }

    const credentials = integration.credentials as any;
    const accessToken = credentials?.accessToken;

    if (!accessToken) {
      return res.status(400).json({
        error: "Token de acesso não encontrado",
        connected: false,
      });
    }

    // Validar token
    const isValid = await GitHubService.validateToken(accessToken);
    if (!isValid) {
      // Marcar integração como erro
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: IntegrationStatus.ERROR },
      });

      return res.status(401).json({
        error: "Token inválido ou expirado",
        connected: false,
      });
    }

    // Obter parâmetros de query
    const type = (req.query.type as string) || "all";
    const sort = (req.query.sort as string) || "updated";
    const direction = (req.query.direction as "asc" | "desc") || "desc";
    const perPage = parseInt(req.query.per_page as string) || 30;
    const page = parseInt(req.query.page as string) || 1;

    // Listar repositórios
    const repositories = await GitHubService.listRepositories(accessToken, {
      type: type as "all" | "owner" | "member",
      sort: sort as "created" | "updated" | "pushed" | "full_name",
      direction,
      per_page: perPage,
      page,
    });

    return res.json({
      repositories,
      integration: {
        id: integration.id,
        name: integration.name,
        connectedAt: integration.connectedAt,
      },
    });
  } catch (error: any) {
    console.error("Erro ao listar repositórios do GitHub:", error);
    return res.status(500).json({
      error: "Erro ao listar repositórios",
      details: error.message,
    });
  }
};

/**
 * Monta um "sprint" a partir do milestone aberto (com menor due date) do
 * repositório GitHub vinculado ao workspace, usando as issues do milestone
 * como tasks. Não depende de nenhum model próprio de sprint/task.
 */
export const getGitHubWorkspaceSprint = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const { workspaceId } = req.params;

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      return res.status(404).json({ error: "Workspace não encontrado" });
    }

    // Verificar se o usuário pertence à empresa do workspace
    const membership = await prisma.companyMember.findUnique({
      where: {
        userId_companyId: {
          userId: req.userId,
          companyId: workspace.companyId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: "Usuário não pertence a esta empresa" });
    }

    if (!workspace.githubRepoFullName) {
      return res.json({ sprint: null });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        userId: req.userId,
        provider: IntegrationProvider.GITHUB,
        status: IntegrationStatus.ACTIVE,
      },
    });

    const accessToken = (integration?.credentials as any)?.accessToken;
    if (!accessToken) {
      return res.json({ sprint: null });
    }

    const [owner, repo] = workspace.githubRepoFullName.split("/");
    const milestones = await GitHubService.listMilestones(accessToken, owner, repo, "open");

    if (milestones.length === 0) {
      return res.json({ sprint: null });
    }

    const milestone = milestones[0];
    const issues = await GitHubService.listIssuesForMilestone(
      accessToken,
      owner,
      repo,
      milestone.number
    );

    const mapPriority = (labels: Array<{ name: string }>): "low" | "medium" | "high" | "urgent" => {
      const names = labels.map((l) => l.name.toLowerCase());
      if (names.some((n) => n.includes("urgent"))) return "urgent";
      if (names.some((n) => n.includes("high"))) return "high";
      if (names.some((n) => n.includes("low"))) return "low";
      return "medium";
    };

    const mapStatus = (
      issue: (typeof issues)[number]
    ): "todo" | "in-progress" | "review" | "done" => {
      if (issue.state === "closed") return "done";
      const names = issue.labels.map((l) => l.name.toLowerCase());
      if (names.some((n) => n.includes("review"))) return "review";
      if (names.some((n) => n.includes("progress") || n.includes("doing"))) return "in-progress";
      return "todo";
    };

    const tasks = issues.map((issue) => ({
      id: String(issue.id),
      title: issue.title,
      status: mapStatus(issue),
      priority: mapPriority(issue.labels),
      labels: issue.labels.map((l) => l.name),
      githubPR: issue.html_url,
      assignee: issue.assignee
        ? { name: issue.assignee.login, avatar: issue.assignee.avatar_url }
        : null,
    }));

    return res.json({
      sprint: {
        id: `milestone-${milestone.number}`,
        name: milestone.title,
        startDate: milestone.created_at,
        endDate: milestone.due_on || milestone.created_at,
        tasks,
        completedTasks: milestone.closed_issues,
        totalTasks: milestone.open_issues + milestone.closed_issues,
      },
    });
  } catch (error: any) {
    console.error("Erro ao montar sprint do GitHub:", error);
    return res.status(500).json({ error: "Erro ao buscar sprint do GitHub" });
  }
};

/**
 * Obtém o status da integração do GitHub
 */
export const getGitHubIntegrationStatus = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        userId: req.userId,
        provider: IntegrationProvider.GITHUB,
      },
    });

    if (!integration) {
      return res.json({
        connected: false,
        status: null,
      });
    }

    // Se a integração está ativa, validar o token
    let isValid = false;
    if (integration.status === IntegrationStatus.ACTIVE) {
      const credentials = integration.credentials as any;
      const accessToken = credentials?.accessToken;
      if (accessToken) {
        isValid = await GitHubService.validateToken(accessToken);
        
        // Se o token for inválido, atualizar status
        if (!isValid) {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { status: IntegrationStatus.ERROR },
          });
        }
      }
    }

    return res.json({
      connected: integration.status === IntegrationStatus.ACTIVE && isValid,
      status: integration.status,
      integration: {
        id: integration.id,
        name: integration.name,
        description: integration.description,
        connectedAt: integration.connectedAt,
        externalUrl: integration.externalUrl,
      },
    });
  } catch (error: any) {
    console.error("Erro ao obter status da integração:", error);
    return res.status(500).json({
      error: "Erro ao obter status da integração",
      details: error.message,
    });
  }
};

/**
 * Desconecta a integração do GitHub
 */
export const disconnectGitHub = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        userId: req.userId,
        provider: IntegrationProvider.GITHUB,
      },
    });

    if (!integration) {
      return res.status(404).json({
        error: "Integração do GitHub não encontrada",
      });
    }

    // Marcar como revogada
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.REVOKED,
        revokedAt: new Date(),
        credentials: Prisma.JsonNull, // Remover credenciais
      },
    });

    return res.json({
      message: "Integração desconectada com sucesso",
    });
  } catch (error: any) {
    console.error("Erro ao desconectar GitHub:", error);
    return res.status(500).json({
      error: "Erro ao desconectar integração",
      details: error.message,
    });
  }
};

/**
 * Inicia o fluxo OAuth do Google Calendar
 * Retorna a URL de autorização
 */
export const initiateGoogleOAuth = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const state = Buffer.from(req.userId).toString("base64");
    const authUrl = GoogleCalendarService.getAuthorizationUrl(state);
    return res.json({ authUrl });
  } catch (error: any) {
    console.error("Erro ao iniciar OAuth do Google:", error);
    return res.status(500).json({
      error: "Erro ao iniciar autenticação do Google",
      details: error.message,
    });
  }
};

/**
 * Callback do OAuth do Google
 * Recebe o código de autorização e salva o token
 * Não requer autenticação - o Google chama diretamente
 */
export const handleGoogleCallback = async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Código de autorização não fornecido" });
    }

    // Decodificar o state para obter o userId
    let userId: string;
    try {
      userId = Buffer.from(state as string, "base64").toString("utf-8");
    } catch {
      return res.status(400).json({ error: "State inválido" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const tokens = await GoogleCalendarService.exchangeCodeForTokens(code);
    const userInfo = await GoogleCalendarService.getUserInfo(tokens.accessToken);

    const externalId = userInfo.sub;
    const displayName = userInfo.name || userInfo.email || "Google";

    await prisma.integration.upsert({
      where: {
        provider_externalId_userId: {
          provider: IntegrationProvider.GOOGLE,
          externalId,
          userId,
        },
      },
      update: {
        status: IntegrationStatus.ACTIVE,
        connectedAt: new Date(),
        revokedAt: null,
        name: displayName,
        description: userInfo.email ? `Conta Google: ${userInfo.email}` : "Conta Google",
        externalUrl: "https://calendar.google.com/",
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiryDate: tokens.expiryDate,
          scope: tokens.scope,
          tokenType: tokens.tokenType,
        },
        config: {
          name: displayName,
          email: userInfo.email,
          picture: userInfo.picture,
        },
      },
      create: {
        provider: IntegrationProvider.GOOGLE,
        name: displayName,
        description: userInfo.email ? `Conta Google: ${userInfo.email}` : "Conta Google",
        status: IntegrationStatus.ACTIVE,
        connectedAt: new Date(),
        externalId,
        externalUrl: "https://calendar.google.com/",
        credentials: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiryDate: tokens.expiryDate,
          scope: tokens.scope,
          tokenType: tokens.tokenType,
        },
        config: {
          name: displayName,
          email: userInfo.email,
          picture: userInfo.picture,
        },
        userId,
      },
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(
      `${frontendUrl}/settings?section=integrations&integration=google&status=connected`
    );
  } catch (error: any) {
    console.error("Erro no callback do Google:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    return res.redirect(
      `${frontendUrl}/settings?section=integrations&integration=google&status=error&message=${encodeURIComponent(
        error.message
      )}`
    );
  }
};

/**
 * Status da integração do Google Calendar
 */
export const getGoogleIntegrationStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const integration = await prisma.integration.findFirst({
      where: { userId: req.userId, provider: IntegrationProvider.GOOGLE },
    });

    if (!integration) {
      return res.json({ connected: false, status: null });
    }

    let isValid = false;
    if (integration.status === IntegrationStatus.ACTIVE) {
      const credentials = integration.credentials as any;
      let accessToken = credentials?.accessToken as string | undefined;
      const refreshToken = credentials?.refreshToken as string | undefined;
      const expiryDate = credentials?.expiryDate as number | undefined;

      // Renovar token se expirado e houver refresh token
      if (accessToken && expiryDate && Date.now() > expiryDate - 60_000 && refreshToken) {
        const refreshed = await GoogleCalendarService.refreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;

        await prisma.integration.update({
          where: { id: integration.id },
          data: {
            credentials: {
              ...credentials,
              accessToken: refreshed.accessToken,
              expiryDate: refreshed.expiryDate,
              scope: refreshed.scope ?? credentials?.scope,
              tokenType: refreshed.tokenType ?? credentials?.tokenType,
            },
          },
        });
      }

      if (accessToken) {
        isValid = await GoogleCalendarService.validateToken(accessToken);
        if (!isValid) {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { status: IntegrationStatus.ERROR },
          });
        }
      }
    }

    return res.json({
      connected: integration.status === IntegrationStatus.ACTIVE && isValid,
      status: integration.status,
      integration: {
        id: integration.id,
        name: integration.name,
        description: integration.description,
        connectedAt: integration.connectedAt,
        externalUrl: integration.externalUrl,
      },
    });
  } catch (error: any) {
    console.error("Erro ao obter status da integração Google:", error);
    return res.status(500).json({
      error: "Erro ao obter status da integração",
      details: error.message,
    });
  }
};

/**
 * Lista calendários do usuário conectado no Google Calendar
 */
export const listGoogleCalendars = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        userId: req.userId,
        provider: IntegrationProvider.GOOGLE,
        status: IntegrationStatus.ACTIVE,
      },
    });

    if (!integration) {
      return res.status(404).json({
        error: "Integração do Google não encontrada",
        connected: false,
      });
    }

    const credentials = integration.credentials as any;
    let accessToken = credentials?.accessToken as string | undefined;
    const refreshToken = credentials?.refreshToken as string | undefined;
    const expiryDate = credentials?.expiryDate as number | undefined;

    if (!accessToken) {
      return res.status(400).json({ error: "Token de acesso não encontrado", connected: false });
    }

    // Renovar se expirado
    if (expiryDate && Date.now() > expiryDate - 60_000 && refreshToken) {
      const refreshed = await GoogleCalendarService.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;

      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          credentials: {
            ...credentials,
            accessToken: refreshed.accessToken,
            expiryDate: refreshed.expiryDate,
            scope: refreshed.scope ?? credentials?.scope,
            tokenType: refreshed.tokenType ?? credentials?.tokenType,
          },
        },
      });
    }

    const isValid = await GoogleCalendarService.validateToken(accessToken);
    if (!isValid) {
      await prisma.integration.update({
        where: { id: integration.id },
        data: { status: IntegrationStatus.ERROR },
      });
      return res.status(401).json({ error: "Token inválido ou expirado", connected: false });
    }

    const calendars = await GoogleCalendarService.listCalendars(accessToken);

    return res.json({
      calendars,
      integration: {
        id: integration.id,
        name: integration.name,
        connectedAt: integration.connectedAt,
      },
    });
  } catch (error: any) {
    console.error("Erro ao listar calendários do Google:", error);
    return res.status(500).json({
      error: "Erro ao listar calendários",
      details: error.message,
    });
  }
};

/**
 * Desconecta a integração do Google
 */
export const disconnectGoogle = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const integration = await prisma.integration.findFirst({
      where: { userId: req.userId, provider: IntegrationProvider.GOOGLE },
    });

    if (!integration) {
      return res.status(404).json({ error: "Integração do Google não encontrada" });
    }

    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        status: IntegrationStatus.REVOKED,
        revokedAt: new Date(),
        credentials: Prisma.JsonNull,
      },
    });

    return res.json({ message: "Integração desconectada com sucesso" });
  } catch (error: any) {
    console.error("Erro ao desconectar Google:", error);
    return res.status(500).json({
      error: "Erro ao desconectar integração",
      details: error.message,
    });
  }
};
