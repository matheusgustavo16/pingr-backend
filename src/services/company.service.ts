import { prisma } from "./prisma.service";
import { MemberStatus } from "@prisma/client";

/**
 * Resolve a empresa "atual" do usuário autenticado: dono OU membro ACTIVE.
 * Mesmo padrão de `getMyCompany`/`createWorkspace` — sem prioridade dono
 * primeiro, pra não divergir quando o usuário é dono da própria empresa E
 * membro ativo de outra (ex: documentos resolvendo pra empresa errada).
 */
export async function resolveUserCompany(userId: string) {
  return prisma.company.findFirst({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId, status: MemberStatus.ACTIVE } } },
      ],
    },
  });
}
