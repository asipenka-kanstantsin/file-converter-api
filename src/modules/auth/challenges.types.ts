export type ChallengePurpose = 'registration';

export interface Challenge {
  attempts: number;
  codeHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
  id: string;
  lastSentAt: Date;
  purpose: ChallengePurpose;
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
