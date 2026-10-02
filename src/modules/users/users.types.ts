import { z } from 'zod';

export const USER_STATUSES = ['active', 'pending_verification'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export interface User {
  createdAt: Date;
  email: string;
  id: string;
  status: UserStatus;
  tokenVersion: number;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  status: UserStatus;
}
