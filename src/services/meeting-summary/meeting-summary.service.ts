import { prisma } from "../prisma.service";
import { AgentLLMProvider, MeetingSummaryStatus, Prisma } from "@prisma/client";
import { createQueue } from "../queue/simple-queue";
import { generateMeetingSummary } from "./summary-provider";
import { buildSummaryMarkdown } from "./markdown-generator";
import { knowledgeEmbeddingService } from "../knowledge/knowledge-embedding.service";

const providerNameToEnum: Record<string, AgentLLMProvider> = {
  anthropic: AgentLLMProvider.ANTHROPIC,
  openai: AgentLLMProvider.OPENAI,
  deepseek: AgentLLMProvider.DEEPSEEK,
};

async function buildTranscriptText(callSessionId: string): Promise<string> {
  const segments = await prisma.transcriptSegment.findMany({
    where: { callSessionId },
    include: { user: { select: { name: true } } },
    orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
  });
  return segments.map((s) => `${s.user?.name ?? "Participante"}: ${s.text}`).join("\n");
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

/** Dispara a geração assíncrona do resumo — chamado quando uma CallSession é encerrada. */
function enqueueForCallSession(callSessionId: string): void {
  queue.enqueue(callSessionId);
}

async function getByCallSession(callSessionId: string) {
  return prisma.meetingSummary.findUnique({ where: { callSessionId } });
}

export const meetingSummaryService = {
  enqueueForCallSession,
  getByCallSession,
};
