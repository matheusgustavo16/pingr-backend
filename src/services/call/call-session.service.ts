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

async function endActive(roomId: string): Promise<void> {
  await prisma.callSession.updateMany({
    where: { roomId, endedAt: null },
    data: { endedAt: new Date() },
  });
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
