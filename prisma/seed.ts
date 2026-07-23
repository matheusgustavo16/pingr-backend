import { prisma } from "../src/services/prisma.service";
import { AgentKind } from "@prisma/client";

const SYSTEM_BOT_NAME = "Pinguelo";

async function upsertSystemBot() {
  let bot = await prisma.chatBot.findFirst({
    where: { companyId: null, provider: "pingr" },
  });

  if (bot) {
    if (bot.name !== SYSTEM_BOT_NAME) {
      bot = await prisma.chatBot.update({
        where: { id: bot.id },
        data: { name: SYSTEM_BOT_NAME },
      });
      console.log(`ChatBot renomeado para "${SYSTEM_BOT_NAME}" (id=${bot.id})`);
    }
  } else {
    bot = await prisma.chatBot.create({
      data: { name: SYSTEM_BOT_NAME, provider: "pingr" },
    });
    console.log(`ChatBot "${SYSTEM_BOT_NAME}" criado (id=${bot.id})`);
  }

  return bot;
}

async function upsertSystemAgent(chatBotId: string) {
  let agent = await prisma.agent.findFirst({ where: { kind: AgentKind.SYSTEM } });

  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        kind: AgentKind.SYSTEM,
        name: SYSTEM_BOT_NAME,
        specialty: "assistente geral da plataforma",
        jobFunction:
          "Ajudar qualquer usuário com agenda, salas, integrações e gestão de outros agentes da empresa.",
        chatBotId,
        allowedTools: [
          "getSchedule",
          "getRoomInfo",
          "getIntegrationStatus",
          "postChatMessage",
          "manageAgent",
        ],
      },
    });
    console.log(`Agent SYSTEM "${SYSTEM_BOT_NAME}" criado (id=${agent.id})`);
  }

  return agent;
}

async function backfillActionLogs(systemAgentId: string) {
  const result = await prisma.agentActionLog.updateMany({
    where: { agentId: null },
    data: { agentId: systemAgentId },
  });
  if (result.count > 0) {
    console.log(`Backfill: ${result.count} AgentActionLog(s) atribuídos ao agente SYSTEM`);
  }
}

const TEMPLATES: Array<{
  name: string;
  age: number;
  specialty: string;
  philosophy: string;
  jobFunction: string;
  allowedTools: string[];
}> = [
  {
    name: "Atlas",
    age: 45,
    specialty: "tráfego pago",
    philosophy:
      "Cada real investido tem que voltar multiplicado. Testar rápido, cortar o que não performa, escalar o que funciona.",
    jobFunction: "Criar campanhas de tráfego pago otimizadas que gastem pouco e tragam resultados.",
    allowedTools: ["getSchedule", "createTask", "postChatMessage"],
  },
  {
    name: "Aura",
    age: 38,
    specialty: "redação e conteúdo",
    philosophy:
      "Texto bom é texto claro. Prefere uma frase direta a três floreadas.",
    jobFunction: "Redigir e revisar conteúdo (posts, descrições, e-mails) alinhado ao tom da empresa.",
    allowedTools: ["createFolder", "postChatMessage"],
  },
  {
    name: "Pulse",
    age: 52,
    specialty: "finanças e controladoria",
    philosophy:
      "Número não mente. Antes de gastar, entender pra onde o dinheiro está indo.",
    jobFunction: "Acompanhar tarefas e prazos financeiros, e alertar sobre pendências.",
    allowedTools: ["getSchedule", "createTask", "createScheduleEvent", "cancelScheduleEvent", "postChatMessage"],
  },
];

async function upsertTemplates() {
  for (const t of TEMPLATES) {
    const existing = await prisma.agent.findFirst({
      where: { kind: AgentKind.TEMPLATE, name: t.name },
    });
    if (existing) continue;

    const agent = await prisma.agent.create({
      data: {
        kind: AgentKind.TEMPLATE,
        name: t.name,
        age: t.age,
        specialty: t.specialty,
        philosophy: t.philosophy,
        jobFunction: t.jobFunction,
        allowedTools: t.allowedTools,
      },
    });
    console.log(`Template "${t.name}" criado (id=${agent.id})`);
  }
}

async function main() {
  const bot = await upsertSystemBot();
  const systemAgent = await upsertSystemAgent(bot.id);
  await backfillActionLogs(systemAgent.id);
  await upsertTemplates();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
