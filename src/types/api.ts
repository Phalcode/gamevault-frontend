// Ported from old-src/types/api.ts for new UI integration
export interface Media {
  id?: number;
  ID?: number;
}

export interface Progress {
  [key: string]: unknown;
}

export enum PermissionRole {
  GUEST = 0,
  USER = 1,
  EDITOR = 2,
  ADMIN = 3,
}

export const PermissionRoleLabel: Record<PermissionRole, string> = {
  [PermissionRole.GUEST]: "GUEST",
  [PermissionRole.USER]: "USER",
  [PermissionRole.EDITOR]: "EDITOR",
  [PermissionRole.ADMIN]: "ADMIN",
};

export function normalizePermissionRole(value: any): PermissionRole | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value in PermissionRole) return value as PermissionRole;
    return null;
  }
  const s = String(value).toUpperCase();
  switch (s) {
    case "0":
    case "GUEST":
      return PermissionRole.GUEST;
    case "1":
    case "USER":
      return PermissionRole.USER;
    case "2":
    case "EDITOR":
      return PermissionRole.EDITOR;
    case "3":
    case "ADMIN":
      return PermissionRole.ADMIN;
    default:
      return null;
  }
}

export interface User {
  id?: number;
  ID?: number;
  username?: string;
  avatar?: Media;
  background?: Media;
  email?: string;
  EMail?: string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  password?: string;
  RepeatPassword?: string;
  api_key?: string;
  ApiKey?: string;
  progresses?: Progress[] | null;
  Progresses?: Progress[] | null;
  role?: PermissionRole | number | null;
  activated?: boolean | "activated" | "deactivated" | null;
  Activated?: boolean | "activated" | "deactivated" | null;
  deleted_at?: string | null;
  DeletedAt?: string | null;
  created_at?: string | Date | null;
  CreatedAt?: string | Date | null;
  birth_date?: string | Date | null;
  BirthDate?: string | Date | null;
}

export interface AuthTokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  [key: string]: unknown;
}
