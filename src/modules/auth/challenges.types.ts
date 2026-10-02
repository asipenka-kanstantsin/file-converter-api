export type ChallengePurpose =
  'account_deletion' | 'email_change' | 'login' | 'registration';

export interface Challenge {
  attempts: number;
  codeHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  lastSentAt: Date;
  // email_change only: the address being confirmed, where the mail goes.
  newEmail: null | string;
  purpose: ChallengePurpose;
  tokenVersion: number | null;
  user: { email: string; id: string };
}

export interface ChallengeSecrets {
  codeHash: string;
  expiresAt: Date;
  sentAt: Date;
  tokenHash: string;
}

export interface IssuedChallenge {
  challengeId: string;
  expiresAt: Date;
}
