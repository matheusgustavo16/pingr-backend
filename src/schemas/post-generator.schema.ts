import { z } from "zod";

export const createPostGenerationSchema = z.object({
  prompt: z.string().trim().min(1, "Prompt é obrigatório").max(4000),
  templateIds: z.array(z.string()).max(10, "No máximo 10 templates de referência").default([]),
  attachmentIds: z.array(z.string()).max(10, "No máximo 10 documentos anexados").default([]),
  /** Agente opcional escolhido pra assumir a composição do prompt final (só usado no compose). */
  agentId: z.string().nullish(),
});
