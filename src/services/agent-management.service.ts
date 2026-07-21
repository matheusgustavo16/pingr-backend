import { Agent, AgentKind, AgentLLMProvider } from "@prisma/client";
import { prisma } from "./prisma.service";

export interface CreateAgentInput {
  companyId: string;
  createdById: string;
  templateId?: string;
  name: string;
  age?: number | null;
  avatarUrl?: string | null;
  specialty: string;
  philosophy?: string | null;
  jobFunction: string;
  provider?: AgentLLMProvider;
  model?: string | null;
  allowedTools?: string[];
  categoryId?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  age?: number | null;
  avatarUrl?: string | null;
  specialty?: string;
  philosophy?: string | null;
  jobFunction?: string;
  provider?: AgentLLMProvider;
  model?: string | null;
  allowedTools?: string[];
  categoryId?: string | null;
}

async function listAgentsByCompany(companyId: string) {
  const agents = await prisma.agent.findMany({
    where: { companyId, kind: AgentKind.COMPANY, isActive: true },
    include: {
      category: true,
      _count: { select: { conversationMessages: true, actionLogs: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return agents.map(({ _count, ...agent }) => ({
    ...agent,
    interactionCount: _count.conversationMessages + _count.actionLogs,
  }));
}

async function listTemplates() {
  return prisma.agent.findMany({
    where: { kind: AgentKind.TEMPLATE, isActive: true },
    orderBy: { createdAt: "asc" },
  });
}

async function getAgent(agentId: string, companyId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { category: true },
  });
  if (!agent || agent.companyId !== companyId) {
    throw new Error("Agente não encontrado");
  }
  return agent;
}

/** Garante que a categoria (se informada) pertence à empresa do agente. */
async function resolveCategoryId(
  companyId: string,
  categoryId: string | null | undefined
): Promise<string | null | undefined> {
  if (categoryId === undefined) return undefined;
  if (categoryId === null) return null;
  const category = await prisma.roomCategory.findFirst({ where: { id: categoryId, companyId } });
  return category ? category.id : null;
}

/**
 * Cria um agente customizado (do zero ou clonando um template) e o ChatBot
 * pareado que ele usa para postar mensagens no chat.
 */
async function createAgent(input: CreateAgentInput): Promise<Agent> {
  const template = input.templateId
    ? await prisma.agent.findFirst({ where: { id: input.templateId, kind: AgentKind.TEMPLATE } })
    : null;
  if (input.templateId && !template) throw new Error("Template não encontrado");

  const base = {
    name: input.name || template?.name || "",
    age: input.age ?? template?.age ?? null,
    avatarUrl: input.avatarUrl ?? template?.avatarUrl ?? null,
    specialty: input.specialty || template?.specialty || "",
    philosophy: input.philosophy ?? template?.philosophy ?? null,
    jobFunction: input.jobFunction || template?.jobFunction || "",
    provider: input.provider ?? template?.provider ?? AgentLLMProvider.ANTHROPIC,
    model: input.model ?? template?.model ?? null,
    allowedTools: input.allowedTools ?? template?.allowedTools ?? [],
  };

  const categoryId = await resolveCategoryId(input.companyId, input.categoryId);

  const bot = await prisma.chatBot.create({
    data: {
      name: base.name,
      picture: base.avatarUrl,
      companyId: input.companyId,
    },
  });

  return prisma.agent.create({
    data: {
      kind: AgentKind.COMPANY,
      companyId: input.companyId,
      createdById: input.createdById,
      templateId: input.templateId,
      chatBotId: bot.id,
      name: base.name,
      age: base.age,
      avatarUrl: base.avatarUrl,
      specialty: base.specialty,
      philosophy: base.philosophy,
      jobFunction: base.jobFunction,
      provider: base.provider,
      model: base.model,
      allowedTools: base.allowedTools,
      categoryId: categoryId ?? null,
    },
  });
}

async function updateAgent(agentId: string, companyId: string, patch: UpdateAgentInput) {
  const agent = await getAgent(agentId, companyId);

  if (patch.name || patch.avatarUrl !== undefined) {
    if (agent.chatBotId) {
      await prisma.chatBot.update({
        where: { id: agent.chatBotId },
        data: {
          name: patch.name ?? undefined,
          picture: patch.avatarUrl === undefined ? undefined : patch.avatarUrl,
        },
      });
    }
  }

  const categoryId = await resolveCategoryId(companyId, patch.categoryId);

  return prisma.agent.update({
    where: { id: agent.id },
    data: { ...patch, categoryId },
    include: { category: true },
  });
}

/**
 * Soft-delete — preserva o histórico em AgentActionLog (agentId aponta pra
 * um agente inativo em vez de ficar órfão).
 */
async function deleteAgent(agentId: string, companyId: string) {
  const agent = await getAgent(agentId, companyId);
  return prisma.agent.update({
    where: { id: agent.id },
    data: { isActive: false },
  });
}

export const AgentManagementService = {
  listAgentsByCompany,
  listTemplates,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
};
