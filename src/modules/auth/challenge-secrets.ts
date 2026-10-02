import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export function newConfirmationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// 32 random bytes → 43 base64url characters (the MagicLinkToken pattern in openapi.yaml).
export function newMagicLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

// A 6-digit code has little entropy, so it is peppered (HMAC) before storage; the link token is
// high-entropy and a plain SHA-256 is enough and allows lookup by hash (09-auth).
export function hashCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
