import { prisma } from "./prisma.service";
import { MemberStatus } from "@prisma/client";

/**
 * Resolve a empresa do usuário autenticado: dono tem prioridade,
 * senão busca a primeira membership ACTIVE.
 */
export async function resolveUserCompany(userId: string) {
  const owned = await prisma.company.findFirst({
    where: { ownerId: userId },
  });

  if (owned) {
    return owned;
  }

  const membership = await prisma.companyMember.findFirst({
    where: { userId, status: MemberStatus.ACTIVE },
    include: { company: true },
  });

  return membership?.company ?? null;
}
