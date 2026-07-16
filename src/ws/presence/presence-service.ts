import { Server as SocketIOServer } from "socket.io";

export interface UserPresence {
  userId: string;
  name: string;
  avatar?: string | null;
  status: "ACTIVE" | "IDLE" | "AWAY";
  userStatus?: string; // status do perfil (AVAILABLE, IN_MEETING, etc)
  lastSeenAt: Date;
  workspaceId?: string;
  companyIds: string[];
  currentRoomId?: string;
  socketId: string;
  isMuted?: boolean;
  isDeafened?: boolean;
}

class PresenceService {
  // Em produção, isso deveria estar no Redis para escalonamento horizontal
  private presenceMap: Map<string, UserPresence> = new Map();

  public updatePresence(
    userId: string,
    data: Partial<UserPresence>
  ): UserPresence {
    const existing = this.presenceMap.get(userId) || {
      userId,
      name: "",
      status: "ACTIVE" as const,
      lastSeenAt: new Date(),
      socketId: "",
      companyIds: [] as string[],
    };

    const updated: UserPresence = {
      ...existing,
      ...data,
      companyIds: data.companyIds ?? existing.companyIds ?? [],
      lastSeenAt: new Date(),
    };
    this.presenceMap.set(userId, updated);
    return updated;
  }

  public removePresence(userId: string) {
    this.presenceMap.delete(userId);
  }

  public getPresence(userId: string): UserPresence | undefined {
    return this.presenceMap.get(userId);
  }

  public getAllPresence(): UserPresence[] {
    return Array.from(this.presenceMap.values());
  }

  public getRoomPresence(roomId: string): UserPresence[] {
    return this.getAllPresence().filter((p) => p.currentRoomId === roomId);
  }

  public getWorkspacePresence(workspaceId: string): UserPresence[] {
    return this.getAllPresence().filter((p) => p.workspaceId === workspaceId);
  }

  public getCompanyPresence(companyId: string): UserPresence[] {
    return this.getAllPresence().filter((p) =>
      (p.companyIds || []).includes(companyId)
    );
  }

  public emitToCompanies(
    io: SocketIOServer,
    companyIds: string[] | undefined,
    event: string,
    payload: unknown
  ) {
    for (const companyId of companyIds || []) {
      io.to(`company:${companyId}`).emit(event, payload);
    }
  }
}

export const presenceService = new PresenceService();
