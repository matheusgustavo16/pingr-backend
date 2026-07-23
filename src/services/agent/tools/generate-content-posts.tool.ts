import { prisma } from "../../prisma.service";
import { getSignedDeliveryUrl } from "../../cloudinary.service";
import {
  analyzeImageReference,
  analyzePdfReference,
  fetchTextReference,
} from "../../post-generation/reference-analysis.service";
import { composeImagePrompt, type ComposerAgent } from "../../post-generation/prompt-composer.service";
import type { ToolDef } from "./types";

interface PostDraftInput {
  title: string;
  details: string;
}

export const generateContentPostsTool: ToolDef = {
  name: "generateContentPosts",
  description:
    'Prepara uma proposta de posts de imagem pra rede social (mesmo motor do Gerador de Conteúdo), publicada como um card no chat com uma aba por post e um botão "Gerar conteúdo" individual em cada uma — a geração da imagem em si só acontece quando alguém clicar. Use quando o usuário pedir explicitamente pra criar/gerar post(s), arte(s) ou imagem(ns) pra rede social a partir da conversa, de uma tarefa vinculada (#) e/ou de um documento anexado. Decida você mesmo quantos posts fazem sentido pro pedido (normalmente 1, mas pode ser vários se o usuário pedir "3 posts sobre X, Y e Z" ou se o documento anexado tiver várias opções distintas) — cada post precisa de um título curto e dos detalhes específicos que o diferenciam dos demais.',
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        description: "Lista de posts a propor — um item por post, na ordem em que devem aparecer nas abas.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Título curto do post (aparece na aba)." },
            details: {
              type: "string",
              description:
                "Descrição do que esse post específico deve comunicar — o que muda em relação aos outros posts da lista, tom, elementos, texto que deve aparecer na arte etc.",
            },
          },
          required: ["title", "details"],
        },
        minItems: 1,
      },
    },
    required: ["posts"],
  },
  run: async (ctx, input) => {
    const rawPosts = Array.isArray(input?.posts) ? input.posts : [];
    const posts: PostDraftInput[] = rawPosts
      .map((p: any) => ({
        title: String(p?.title ?? "").trim(),
        details: String(p?.details ?? "").trim(),
      }))
      .filter((p: PostDraftInput) => p.title.length > 0);
    if (posts.length === 0) throw new Error("posts é obrigatório e precisa de ao menos 1 item com title");

    if (!ctx.roomId || !ctx.channelId) {
      throw new Error("generateContentPosts só pode ser usada numa sala com canal de chat");
    }
    const roomId = ctx.roomId;
    const channelId = ctx.channelId;

    const [agentRow, task, attachments] = await Promise.all([
      prisma.agent.findUnique({ where: { id: ctx.agentId } }),
      ctx.taskId
        ? prisma.task.findFirst({ where: { id: ctx.taskId, companyId: ctx.companyId } })
        : Promise.resolve(null),
      ctx.attachmentIds && ctx.attachmentIds.length > 0
        ? prisma.document.findMany({ where: { id: { in: ctx.attachmentIds }, companyId: ctx.companyId } })
        : Promise.resolve([]),
    ]);

    const agent: ComposerAgent | null = agentRow
      ? {
          provider: agentRow.provider,
          model: agentRow.model,
          name: agentRow.name,
          specialty: agentRow.specialty,
          philosophy: agentRow.philosophy,
        }
      : null;

    const sharedNotes: string[] = [];
    if (task) {
      sharedNotes.push(`Tarefa vinculada "${task.title}"${task.description ? `: ${task.description}` : ""}`);
    }

    // Mesma lógica de composeGeneration: se o agente usa um provider com
    // visão, a análise de imagem usa o provider dele em vez do fallback fixo.
    const imageAnalysisProvider =
      agent?.provider === "OPENAI" || agent?.provider === "ANTHROPIC" ? agent.provider : undefined;

    const attachmentAnalyses = await Promise.all(
      attachments.map(async (doc): Promise<string | null> => {
        // Documento já analisado no upload (document-analysis.service.ts) — reaproveita
        // em vez de reprocessar o arquivo a cada chamada da tool.
        if (doc.analysisStatus === "COMPLETED" && doc.description) {
          const label = doc.fileType?.startsWith("image/") ? "Imagem anexada" : "Documento anexado";
          return `${label} "${doc.fileName}": ${doc.description}`;
        }

        const signedUrl = getSignedDeliveryUrl({
          publicId: doc.publicId,
          fileUrl: doc.fileUrl,
          fileName: doc.fileName,
          fileType: doc.fileType,
        });
        try {
          let description: string | null = null;
          let label: string | null = null;
          if (doc.fileType?.startsWith("image/")) {
            label = "Imagem anexada";
            description = await analyzeImageReference(signedUrl, imageAnalysisProvider);
          } else if (doc.fileType === "application/pdf") {
            label = "Documento anexado";
            description = await analyzePdfReference(signedUrl);
          } else if (doc.fileType?.startsWith("text/")) {
            label = "Documento anexado";
            description = await fetchTextReference(signedUrl);
          } else {
            return null;
          }

          await prisma.document
            .update({ where: { id: doc.id }, data: { description, analysisStatus: "COMPLETED", analysisError: null } })
            .catch((error) => console.error(`[generateContentPosts] falha ao cachear análise do anexo ${doc.id}:`, error));

          return `${label} "${doc.fileName}": ${description}`;
        } catch (error) {
          console.error(`[generateContentPosts] falha ao analisar anexo ${doc.id}:`, error);
          return null;
        }
      })
    );
    sharedNotes.push(...attachmentAnalyses.filter((note): note is string => note !== null));

    const composed = await Promise.all(
      posts.map((post) =>
        composeImagePrompt({
          userRequest: `${post.title}\n${post.details}`,
          referenceNotes: sharedNotes,
          agent,
        })
      )
    );

    const proposal = await prisma.chatPostProposal.create({
      data: {
        companyId: ctx.companyId,
        roomId,
        channelId,
        createdByUserId: ctx.userId,
        agentId: ctx.agentId,
        taskId: task?.id ?? null,
        attachments: attachments.length > 0 ? { connect: attachments.map((d) => ({ id: d.id })) } : undefined,
        items: {
          create: posts.map((post, index) => ({
            index,
            title: post.title,
            details: post.details,
            promptEn: composed[index].promptEn,
            promptPt: composed[index].promptPt,
          })),
        },
      },
    });

    return {
      proposalId: proposal.id,
      posts: posts.map((post, index) => ({ index, title: post.title })),
    };
  },
};
