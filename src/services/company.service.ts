import { prisma } from "./prisma.service";
import { MemberStatus } from "@prisma/client";

/**
 * Fallback de último recurso quando não há claim de empresa ativa válida
 * (token antigo sem `companyId`, ou claim apontando pra membership revogada).
 * Determinístico por `createdAt` — mas para usuário em múltiplas empresas,
 * a escolha "certa" é sempre a `companyId` ativa vinda do JWT/`getActiveCompanyForUser`,
 * nunca esta função isolada.
 */
export async function resolveUserCompany(userId: string) {
  return prisma.company.findFirst({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId, status: MemberStatus.ACTIVE } } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Verifica se o usuário é dono OU membro ACTIVE da empresa informada.
 */
export async function isUserInCompany(userId: string, companyId: string) {
  return prisma.company.findFirst({
    where: {
      id: companyId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, status: MemberStatus.ACTIVE } } },
      ],
    },
  });
}

/**
 * Resolve a empresa "ativa" da requisição atual.
 * Se `claimedCompanyId` (vindo da claim do JWT) for informado, revalida a
 * cada request que o usuário ainda é dono/membro ativo dela — não confia
 * cegamente na claim, pra pegar revogação de membership imediatamente.
 * Sem claim válida, cai no fallback de último recurso `resolveUserCompany`.
 */
export async function getActiveCompanyForUser(
  userId: string,
  claimedCompanyId?: string | null
) {
  if (claimedCompanyId) {
    const valid = await isUserInCompany(userId, claimedCompanyId);
    if (valid) return valid;
  }
  return resolveUserCompany(userId);
}

/**
 * Lista todas as empresas do usuário (dono + membro ativo), pra UI de troca.
 */
export async function listUserCompanies(userId: string) {
  const [owned, memberships] = await Promise.all([
    prisma.company.findMany({
      where: { ownerId: userId },
      select: { id: true, title: true, picture: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.companyMember.findMany({
      where: { userId, status: MemberStatus.ACTIVE },
      select: {
        role: true,
        company: { select: { id: true, title: true, picture: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const result = new Map<
    string,
    { id: string; title: string; picture: string | null; role: string }
  >();

  for (const company of owned) {
    result.set(company.id, { ...company, role: "OWNER" });
  }
  for (const membership of memberships) {
    if (!result.has(membership.company.id)) {
      result.set(membership.company.id, {
        ...membership.company,
        role: membership.role,
      });
    }
  }

  return Array.from(result.values());
}
