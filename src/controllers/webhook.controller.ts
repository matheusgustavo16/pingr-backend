import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../services/prisma.service";
import { ChatService } from "../services/chat.service";
import { GitHubService } from "../services/github.service";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

/**
 * Verifica a assinatura do webhook do GitHub
 */
function verifyGitHubSignature(
  payload: string,
  signature: string | undefined
): boolean {
  if (!GITHUB_WEBHOOK_SECRET || !signature) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * Processa evento de push do GitHub
 */
async function processPushEvent(
  payload: any,
  workspace: any,
  channel: { id: string },
  botId: string
) {
  const { ref, commits, repository, pusher } = payload;
  const branch = ref.replace("refs/heads/", "");

  if (commits && commits.length > 0) {
    const commit = commits[commits.length - 1]; // Último commit
    const commitCount = commits.length;

    const metadata = {
      type: "commit",
      data: {
        sha: commit.id.substring(0, 7),
        message: commit.message,
        author: commit.author.name || pusher.name,
        repo: repository.full_name,
        branch,
        url: commit.url,
        createdAt: new Date(commit.timestamp),
        additions: 0, // GitHub não fornece isso no webhook push
        deletions: 0, // GitHub não fornece isso no webhook push
        filesChanged: (commit.added?.length || 0) + (commit.modified?.length || 0) + (commit.removed?.length || 0),
      },
    };

    const message = commitCount === 1 
      ? `📝 Novo commit no repositório`
      : `📝 ${commitCount} novos commits no repositório`;

    await ChatService.sendMessage(
      {
        content: JSON.stringify(metadata),
        type: "BOT" as any,
        channelId: channel.id,
        botId,
      },
      "" // userId não necessário para bot
    );
  }
}

/**
 * Processa evento de pull request do GitHub
 */
async function processPullRequestEvent(
  payload: any,
  workspace: any,
  channel: { id: string },
  botId: string
) {
  const { action, pull_request, repository } = payload;
  const pr = pull_request;

  const metadata = {
    type: "pr",
    data: {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      author: pr.user.login,
      repo: repository.full_name,
      status: pr.state === "closed" ? (pr.merged ? "merged" : "closed") : "open",
      url: pr.html_url,
      createdAt: new Date(pr.created_at),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      comments: pr.comments || 0,
      reviews: 0, // GitHub não retorna isso no webhook
    },
  };

  let message = "";
  if (action === "opened") {
    message = "🔔 Novo Pull Request criado";
  } else if (action === "closed" && pr.merged) {
    message = "✅ Pull Request aprovado e mergeado";
  } else if (action === "closed") {
    message = "❌ Pull Request fechado";
  } else if (action === "reopened") {
    message = "🔄 Pull Request reaberto";
  } else {
    return; // Não processar outras ações por enquanto
  }

  await ChatService.sendMessage(
    {
      content: JSON.stringify(metadata),
      type: "BOT" as any,
      channelId: channel.id,
      botId,
    },
    ""
  );
}

/**
 * Processa evento de deploy/release do GitHub
 */
async function processReleaseEvent(
  payload: any,
  workspace: any,
  channel: { id: string },
  botId: string
) {
  const { action, release, repository } = payload;

  if (action !== "published") {
    return;
  }

  const metadata = {
    type: "deploy",
    data: {
      environment: "production",
      version: release.tag_name,
      status: "success",
      url: release.html_url,
      deployedAt: new Date(release.published_at),
      duration: 0,
      commit: release.target_commitish?.substring(0, 7) || "",
      branch: release.target_commitish || "main",
      build: release.id.toString(),
      logsUrl: release.html_url,
    },
  };

  await ChatService.sendMessage(
    {
      content: JSON.stringify(metadata),
      type: "BOT" as any,
      channelId: channel.id,
      botId,
    },
    ""
  );
}

/**
 * Endpoint para receber webhooks do GitHub
 * POST /webhooks/github
 */
export const handleGitHubWebhook = async (req: Request, res: Response) => {
  try {
    // Verificar assinatura se secret estiver configurado
    const signature = req.headers["x-hub-signature-256"] as string;
    // Usar rawBody se disponível, senão stringify do body
    const rawBody = (req as any).rawBody 
      ? (req as any).rawBody.toString() 
      : JSON.stringify(req.body);
    const payload = rawBody;

    if (GITHUB_WEBHOOK_SECRET && !verifyGitHubSignature(payload, signature)) {
      return res.status(401).json({ error: "Assinatura inválida" });
    }

    const event = req.headers["x-github-event"] as string;
    const deliveryId = req.headers["x-github-delivery"] as string;

    if (!event || !deliveryId) {
      return res.status(400).json({ error: "Headers do GitHub ausentes" });
    }

    // Buscar workspace pelo repositório
    const repository = req.body.repository;
    if (!repository || !repository.full_name) {
      return res.status(400).json({ error: "Repositório não encontrado no payload" });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        githubRepoFullName: repository.full_name,
      },
      include: {
        rooms: {
          where: {
            title: "Atualizações",
          },
        },
        company: true,
      },
    });

    if (!workspace) {
      console.log(`Workspace não encontrado para repositório: ${repository.full_name}`);
      return res.status(200).json({ message: "Workspace não encontrado" });
    }

    const room = workspace.rooms[0];
    if (!room) {
      console.log(`Canal de atualizações não encontrado para workspace: ${workspace.id}`);
      return res.status(200).json({ message: "Canal não encontrado" });
    }

    // Buscar canal de chat da sala
    const channel = await ChatService.getChannelByRoomId(room.id);
    if (!channel) {
      console.log(`Canal de chat não encontrado para sala: ${room.id}`);
      return res.status(200).json({ message: "Canal de chat não encontrado" });
    }

    // Buscar bot do agente de sistema (Pinguelo)
    let bot;
    try {
      bot = await ChatService.getSystemAgentBot();
    } catch (error) {
      console.error("Erro ao buscar bot do Pinguelo:", error);
      return res.status(500).json({ error: "Bot não encontrado" });
    }

    // Processar evento baseado no tipo
    switch (event) {
      case "push":
        await processPushEvent(req.body, workspace, channel, bot.id);
        break;
      case "pull_request":
        await processPullRequestEvent(req.body, workspace, channel, bot.id);
        break;
      case "release":
        await processReleaseEvent(req.body, workspace, channel, bot.id);
        break;
      default:
        console.log(`Evento não processado: ${event}`);
    }

    return res.status(200).json({ message: "Webhook processado com sucesso" });
  } catch (error: any) {
    console.error("Erro ao processar webhook do GitHub:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};
