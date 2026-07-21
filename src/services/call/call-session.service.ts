import { prisma } from "../prisma.service";

// Deduplica criações concorrentes de sessão para a mesma sala (dois producers
// de áudio podendo chegar quase simultaneamente ao entrar numa call).
const pendingStarts = new Map<string, Promise<string>>();

async function startOrGetActive(roomId: string, userId: string): Promise<string> {
  const existing = pendingStarts.get(roomId);
  if (existing) return existing;

  const promise = (async () => {
    const active = await prisma.callSession.findFirst({
      where: { roomId, endedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (active) return active.id;

    const created = await prisma.callSession.create({
      data: { roomId, startedById: userId },
    });
    return created.id;
  })();

  pendingStarts.set(roomId, promise);
  try {
    return await promise;
  } finally {
    pendingStarts.delete(roomId);
  }
}

// Retorna os ids das sessões que acabaram de ser encerradas (endedAt era
// null antes desta chamada) — o caller usa isso pra saber pra quais sessões
// disparar o processamento pós-call (ex: geração de resumo), sem disparar de
// novo em chamadas subsequentes que não fecham nada.
async function endActive(roomId: string): Promise<string[]> {
  const active = await prisma.callSession.findMany({
    where: { roomId, endedAt: null },
    select: { id: true },
  });
  if (active.length === 0) return [];

  const ids = active.map((s) => s.id);
  await prisma.callSession.updateMany({
    where: { id: { in: ids } },
    data: { endedAt: new Date() },
  });
  return ids;
}

async function getActiveId(roomId: string): Promise<string | null> {
  const active = await prisma.callSession.findFirst({
    where: { roomId, endedAt: null },
    select: { id: true },
  });
  return active?.id ?? null;
}

export const callSessionService = {
  startOrGetActive,
  endActive,
  getActiveId,
};
