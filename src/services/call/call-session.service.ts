import { prisma } from "../prisma.service";

// Deduplica criações concorrentes de sessão para a mesma sala (dois producers
// de áudio podendo chegar quase simultaneamente ao entrar numa call).
const pendingStarts = new Map<string, Promise<string>>();

// Reconexão dentro desta janela (todo mundo saiu e alguém volta logo em
// seguida) é tratada como a mesma reunião — a nova CallSession se junta ao
// cluster da anterior em vez de virar uma reunião/resumo separado.
const CLUSTER_GAP_MS = 10 * 60 * 1000;

async function startOrGetActive(roomId: string, userId: string): Promise<string> {
  const existing = pendingStarts.get(roomId);
  if (existing) return existing;

  const promise = (async () => {
    const active = await prisma.callSession.findFirst({
      where: { roomId, endedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (active) return active.id;

    const lastEnded = await prisma.callSession.findFirst({
      where: { roomId, endedAt: { not: null } },
      orderBy: { endedAt: "desc" },
      select: { id: true, endedAt: true, mergedIntoId: true },
    });

    const mergedIntoId =
      lastEnded?.endedAt && Date.now() - lastEnded.endedAt.getTime() < CLUSTER_GAP_MS
        ? lastEnded.mergedIntoId ?? lastEnded.id
        : null;

    const created = await prisma.callSession.create({
      data: { roomId, startedById: userId, mergedIntoId },
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

// Retorna os ids RAIZ dos clusters que acabaram de fechar (endedAt era null
// antes desta chamada) — o caller usa isso pra saber pra quais reuniões
// disparar o processamento pós-call (ex: geração de resumo), sem disparar de
// novo em chamadas subsequentes que não fecham nada. Sessão que fez merge
// numa reconexão devolve a raiz do cluster, não o próprio id, pra reprocessar
// o resumo combinado em vez de criar um resumo picado só do pedaço novo.
async function endActive(roomId: string): Promise<string[]> {
  const active = await prisma.callSession.findMany({
    where: { roomId, endedAt: null },
    select: { id: true, mergedIntoId: true },
  });
  if (active.length === 0) return [];

  const ids = active.map((s) => s.id);
  await prisma.callSession.updateMany({
    where: { id: { in: ids } },
    data: { endedAt: new Date() },
  });

  const rootIds = new Set(active.map((s) => s.mergedIntoId ?? s.id));
  return Array.from(rootIds);
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
