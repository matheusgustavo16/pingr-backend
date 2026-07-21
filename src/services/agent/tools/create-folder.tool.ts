import { prisma } from "../../prisma.service";
import { requireFolderInCompany } from "../../document.service";
import type { ToolDef } from "./types";

export const createFolderTool: ToolDef = {
  name: "createFolder",
  description:
    "Cria uma pasta (apenas metadata, sem upload de arquivo) no gerenciador de documentos da empresa.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Nome da pasta." },
      parentId: { type: "string", description: "Id da pasta pai (opcional, raiz se omitido)." },
    },
    required: ["title"],
  },
  run: async (ctx, input) => {
    const title = String(input?.title ?? "").trim();
    if (!title) throw new Error("title é obrigatório");

    let workspaceId: string | null = null;
    const parentId = typeof input?.parentId === "string" ? input.parentId : null;
    if (parentId) {
      const parent = await requireFolderInCompany(parentId, ctx.companyId);
      workspaceId = parent.workspaceId;
    }

    const folder = await prisma.folder.create({
      data: {
        title,
        parentId,
        workspaceId,
        companyId: ctx.companyId,
        createdById: ctx.userId,
      },
    });

    return { id: folder.id, title: folder.title };
  },
};
