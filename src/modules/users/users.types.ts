import { z } from 'zod';

export const USER_STATUSES = [
  'active',
  'blocked',
  'deleted',
  'pending_verification',
] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export interface User {
  createdAt: Date;
  displayName: null | string;
  email: string;
  id: string;
  lastLoginAt: Date | null;
  photoFileId: null | string;
  status: UserStatus;
  tokenVersion: number;
}

// What an edit may change (Notion "Изменение данных пользователя"); which of these a caller may
// send is decided by the accounts module.
export interface UserChanges {
  displayName?: null | string;
  email?: string;
  status?: Extract<UserStatus, 'active' | 'blocked'>;
}

export interface SessionUser extends User {
  roleIds: string[];
}

export interface UserCredentials {
  passwordHash: string;
  user: User;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  status: UserStatus;
}
