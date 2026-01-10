export type Role = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER" | "GUEST";

export const PERMISSIONS = {
  ENTER_OPEN_ROOM: ["OWNER", "ADMIN", "MODERATOR", "MEMBER", "GUEST"],
  ENTER_CLOSED_ROOM: ["OWNER", "ADMIN", "MODERATOR"],
  CREATE_ROOM: ["OWNER", "ADMIN"],
  KICK_USER: ["OWNER", "ADMIN", "MODERATOR"],
  VIEW_PRIVATE_ZONE: ["OWNER", "ADMIN", "MODERATOR"],
};

export class AuthorizationService {
  public static can(
    userRoles: string[],
    action: keyof typeof PERMISSIONS
  ): boolean {
    const allowedRoles = PERMISSIONS[action];
    return userRoles.some((role) => allowedRoles.includes(role));
  }

  public static isAtLeast(userRoles: string[], requiredRole: Role): boolean {
    const rolesHierarchy: Role[] = [
      "GUEST",
      "MEMBER",
      "MODERATOR",
      "ADMIN",
      "OWNER",
    ];
    const highestUserRoleIndex = Math.max(
      ...userRoles.map((r) => rolesHierarchy.indexOf(r as Role))
    );
    const requiredRoleIndex = rolesHierarchy.indexOf(requiredRole);

    return highestUserRoleIndex >= requiredRoleIndex;
  }
}
