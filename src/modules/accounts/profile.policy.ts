import type { User } from '@/modules/users';

// Decision P1 (Notion "Просмотр данных пользователя" 1.3.1: "список разрешённых полей ... требует
// фиксации"). Default-deny: a field reaches the response only if it is listed for the audience.
export const PROFILE_FIELDS = {
  // Another user's profile, for a viewer holding users@read.
  other: ['createdAt', 'displayName', 'status'],
  // One's own profile.
  self: ['createdAt', 'displayName', 'lastLoginAt', 'status'],
} as const satisfies Record<string, readonly ProfileField[]>;

export type ProfileAudience = keyof typeof PROFILE_FIELDS;
type ProfileField = 'createdAt' | 'displayName' | 'lastLoginAt' | 'status';

export interface Profile {
  email: string;
  fields: Partial<Record<ProfileField, Date | null | string>>;
  id: string;
  photo: null | string;
}

export function toProfile(user: User, audience: ProfileAudience): Profile {
  const fields: Profile['fields'] = {};
  for (const field of PROFILE_FIELDS[audience]) fields[field] = user[field];
  return {
    email: user.email,
    fields,
    id: user.id,
    // The API path, never a storage URL (F4).
    photo: user.photoFileId ? `/api/users/${user.id}/photo` : null,
  };
}
