import { prisma } from "./prisma.service";

export class DocumentServiceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function requireFolderInCompany(folderId: string, companyId: string) {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, companyId } });
  if (!folder) {
    throw new DocumentServiceError("Pasta não encontrada", 404);
  }
  return folder;
}

export async function requireDocumentInCompany(documentId: string, companyId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId } });
  if (!document) {
    throw new DocumentServiceError("Documento não encontrado", 404);
  }
  return document;
}

/**
 * Sobe a cadeia de pais raiz->atual pra montar o breadcrumb. Guard de profundidade
 * é só defesa contra ciclo acidental — o app nunca deveria produzir um.
 */
export async function getBreadcrumb(folderId: string, companyId: string) {
  const chain: { id: string; title: string }[] = [];
  let currentId: string | null = folderId;
  let guard = 0;
  while (currentId && guard++ < 50) {
    const folder: { id: string; title: string; parentId: string | null } | null =
      await prisma.folder.findFirst({
        where: { id: currentId, companyId },
        select: { id: true, title: true, parentId: true },
      });
    if (!folder) break;
    chain.unshift({ id: folder.id, title: folder.title });
    currentId = folder.parentId;
  }
  return chain;
}

/**
 * Impede mover uma pasta pra dentro dela mesma ou de um dos seus próprios descendentes.
 */
export async function assertNotDescendant(folderId: string, targetParentId: string, companyId: string) {
  let currentId: string | null = targetParentId;
  let guard = 0;
  while (currentId && guard++ < 50) {
    if (currentId === folderId) {
      throw new DocumentServiceError("Não é possível mover uma pasta para dentro dela mesma", 400);
    }
    const parent: { parentId: string | null } | null = await prisma.folder.findFirst({
      where: { id: currentId, companyId },
      select: { parentId: true },
    });
    currentId = parent?.parentId ?? null;
  }
}

/**
 * BFS iterativo coletando o id da pasta raiz + todos os descendentes (Prisma não
 * tem query recursiva nativa), usado antes de deletar pra limpar o Cloudinary.
 */
export async function collectFolderSubtreeIds(rootFolderId: string, companyId: string): Promise<string[]> {
  const all = [rootFolderId];
  let frontier = [rootFolderId];
  while (frontier.length > 0) {
    const children = await prisma.folder.findMany({
      where: { companyId, parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    all.push(...frontier);
  }
  return all;
}
