import { prisma } from "../prisma.service";
import { AgentLLMProvider, MeetingSummaryStatus, Prisma } from "@prisma/client";
import { createQueue } from "../queue/simple-queue";
import { generateMeetingSummary } from "./summary-provider";
import { buildSummaryMarkdown } from "./markdown-generator";
import { knowledgeEmbeddingService } from "../knowledge/knowledge-embedding.service";
import { NotificationService } from "../notification.service";

const providerNameToEnum: Record<string, AgentLLMProvider> = {
  anthropic: AgentLLMProvider.ANTHROPIC,
  openai: AgentLLMProvider.OPENAI,
  deepseek: AgentLLMProvider.DEEPSEEK,
};

// Sessão raiz + todas as que se juntaram a ela por reconexão rápida (ver
// CLUSTER_GAP_MS em call-session.service.ts) — juntas formam uma reunião só.
async function getClusterSessionIds(rootCallSessionId: string): Promise<string[]> {
  const members = await prisma.callSession.findMany({
    where: { OR: [{ id: rootCallSessionId }, { mergedIntoId: rootCallSessionId }] },
    select: { id: true },
  });
  return members.map((m) => m.id);
}

async function buildTranscriptText(rootCallSessionId: string): Promise<string> {
  const callSessionIds = await getClusterSessionIds(rootCallSessionId);
  const segments = await prisma.transcriptSegment.findMany({
    where: { callSessionId: { in: callSessionIds } },
    include: { user: { select: { name: true } } },
    // createdAt (absoluto) em vez de startMs (relativo a cada sessão) —
    // com múltiplas sessões no cluster, startMs de sessões diferentes não é
    // comparável entre si.
    orderBy: { createdAt: "asc" },
  });
  return segments.map((s) => `${s.user?.name ?? "Participante"}: ${s.text}`).join("\n");
}

async function notifyParticipants(callSessionId: string): Promise<void> {
  const [callSession, participantIds] = await Promise.all([
    prisma.callSession.findUnique({
      where: { id: callSessionId },
      select: { room: { select: { title: true } } },
    }),
    prisma.transcriptSegment.findMany({
      where: { callSessionId, isFinal: true },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  if (!callSession || participantIds.length === 0) return;

  await NotificationService.createMany(
    participantIds.map(({ userId }) => ({
      userId,
      type: "MEETING",
      title: "Resumo da reunião disponível",
      description: `O resumo da reunião em "${callSession.room.title}" já pode ser consultado.`,
      actionUrl: "/office/transcriptions",
    }))
  );
}

async function process(callSessionId: string): Promise<void> {
  await prisma.meetingSummary.upsert({
    where: { callSessionId },
    create: { callSessionId, status: MeetingSummaryStatus.PROCESSING },
    update: { status: MeetingSummaryStatus.PROCESSING, errorMessage: null },
  });

  try {
    const transcript = await buildTranscriptText(callSessionId);
    if (!transcript.trim()) {
      await prisma.meetingSummary.update({
        where: { callSessionId },
        data: { status: MeetingSummaryStatus.FAILED, errorMessage: "Transcrição vazia" },
      });
      return;
    }

    const { json, providerName, model } = await generateMeetingSummary(transcript);
    const markdown = buildSummaryMarkdown(json);

    await prisma.meetingSummary.update({
      where: { callSessionId },
      data: {
        status: MeetingSummaryStatus.COMPLETED,
        provider: providerNameToEnum[providerName],
        model,
        summary: json.summary,
        decisions: json.decisions as Prisma.InputJsonValue,
        actionItems: json.actionItems as Prisma.InputJsonValue,
        risks: json.risks as Prisma.InputJsonValue,
        insights: json.insights as Prisma.InputJsonValue,
        discussedTopics: json.discussedTopics as Prisma.InputJsonValue,
        keywords: json.keywords,
        markdown,
        errorMessage: null,
      },
    });

    knowledgeEmbeddingService.enqueueForSummary(callSessionId).catch((err) => {
      console.error(`[knowledge-embedding] falha ao enfileirar callSession ${callSessionId}:`, err);
    });

    notifyParticipants(callSessionId).catch((err) => {
      console.error(`[meeting-summary] falha ao notificar participantes ${callSessionId}:`, err);
    });
  } catch (err: any) {
    console.error(`[meeting-summary] falhou para callSession ${callSessionId}:`, err);
    await prisma.meetingSummary
      .update({
        where: { callSessionId },
        data: { status: MeetingSummaryStatus.FAILED, errorMessage: err?.message || "Erro desconhecido" },
      })
      .catch(() => {});
  }
}

const queue = createQueue<string>("meeting-summary", process);

/**
 * Dispara a geração assíncrona do resumo — chamado quando uma CallSession é
 * encerrada. Não enfileira nada se a sessão não teve nenhuma transcrição de
 * usuário (call sem ninguém falando).
 */
async function enqueueForCallSession(rootCallSessionId: string): Promise<void> {
  const callSessionIds = await getClusterSessionIds(rootCallSessionId);
  const count = await prisma.transcriptSegment.count({
    where: { callSessionId: { in: callSessionIds }, isFinal: true },
  });
  if (count === 0) return;
  queue.enqueue(rootCallSessionId);
}

async function getByCallSession(callSessionId: string) {
  return prisma.meetingSummary.findUnique({ where: { callSessionId } });
}

/**
 * Geração sob demanda (botão "Gerar resumo" na lista) — usa o mesmo cluster
 * e a mesma fila do fluxo automático. Retorna `null` quando não há
 * transcrição final pra resumir (nada pra gerar).
 */
async function triggerManualGeneration(rootCallSessionId: string) {
  const callSessionIds = await getClusterSessionIds(rootCallSessionId);
  const count = await prisma.transcriptSegment.count({
    where: { callSessionId: { in: callSessionIds }, isFinal: true },
  });
  if (count === 0) return null;

  const summary = await prisma.meetingSummary.upsert({
    where: { callSessionId: rootCallSessionId },
    create: { callSessionId: rootCallSessionId, status: MeetingSummaryStatus.PENDING },
    update: { status: MeetingSummaryStatus.PENDING, errorMessage: null },
  });
  queue.enqueue(rootCallSessionId);
  return summary;
}

export const meetingSummaryService = {
  enqueueForCallSession,
  getByCallSession,
  triggerManualGeneration,
};
