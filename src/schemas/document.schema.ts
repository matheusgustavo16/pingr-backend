import { z } from "zod";

export const createFolderSchema = z.object({
  title: z.string().trim().min(1, "Título é obrigatório"),
  parentId: z.string().optional().nullable(),
  workspaceId: z.string().optional().nullable(),
});

export const updateFolderSchema = z.object({
  title: z.string().trim().min(1).optional(),
  parentId: z.string().optional().nullable(),
});

export const updateDocumentSchema = z.object({
  fileName: z.string().trim().min(1).optional(),
  folderId: z.string().optional().nullable(),
});
