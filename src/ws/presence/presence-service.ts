import { Server as SocketIOServer } from "socket.io";

export interface UserPresence {
  userId: string;
  name: string;
  status: "ACTIVE" | "IDLE" | "AWAY";
  lastSeenAt: Date;
  workspaceId?: string;
  currentRoomId?: string;
  socketId: string;
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
      status: "ACTIVE",
      lastSeenAt: new Date(),
      socketId: "",
    };

    const updated = { ...existing, ...data, lastSeenAt: new Date() };
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
}

export const presenceService = new PresenceService();
