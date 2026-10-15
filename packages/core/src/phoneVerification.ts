// Pure rules for the SMS number-verification flow. The Edge Function owns the
// I/O (database, SMS provider, crypto); everything decidable lives here so it
// can be tested. Self-contained (no relative imports) for the same reason as
// the other modules the Edge Functions import.

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CONFIRM_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const SEND_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SENDS_PER_WINDOW = 5;

// Largest multiple of 1,000,000 below 2^32. Draws at or above it are thrown
// away so every six-digit code is equally likely (no modulo bias).
const UNBIASED_LIMIT = 4294000000;

export function generateVerificationCode(randomUint32: () => number): string {
  let value = randomUint32();
  while (value >= UNBIASED_LIMIT) value = randomUint32();
  return String(value % 1000000).padStart(6, '0');
}

export async function hashVerificationCode(
  sha256Hex: (input: string) => Promise<string>,
  userId: string,
  phone: string,
  code: string
): Promise<string> {
  return sha256Hex(`${userId}:${phone}:${code}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface PendingVerification {
  phoneE164: string;
  codeHash: string;
  expiresAt: string;
  attempts: number;
  lastSentAt: string;
  sendsInWindow: number;
  windowStartedAt: string;
}

export type SendDecision =
  | { allowed: true; sendsInWindow: number; windowStartedAt: string }
  | { allowed: false; retryAfterSeconds: number };

export function checkSendAllowed(pending: PendingVerification | null, now: Date): SendDecision {
  if (!pending) {
    return { allowed: true, sendsInWindow: 1, windowStartedAt: now.toISOString() };
  }

  const sinceLastSend = now.getTime() - Date.parse(pending.lastSentAt);
  if (sinceLastSend < RESEND_COOLDOWN_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((RESEND_COOLDOWN_MS - sinceLastSend) / 1000) };
  }

  const windowAge = now.getTime() - Date.parse(pending.windowStartedAt);
  if (windowAge >= SEND_WINDOW_MS) {
    return { allowed: true, sendsInWindow: 1, windowStartedAt: now.toISOString() };
  }
  if (pending.sendsInWindow >= MAX_SENDS_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.ceil((SEND_WINDOW_MS - windowAge) / 1000) };
  }
  return {
    allowed: true,
    sendsInWindow: pending.sendsInWindow + 1,
    windowStartedAt: pending.windowStartedAt,
  };
}

export type ConfirmDecision =
  | { kind: 'ok' }
  | { kind: 'no_pending' }
  | { kind: 'expired' }
  | { kind: 'too_many_attempts' }
  | { kind: 'wrong_code'; attemptsLeft: number };

/**
 * `pending.attempts` must already include the attempt being evaluated — the
 * caller increments it in the database first, so concurrent guesses can't
 * share one attempt.
 */
export function evaluateConfirm(
  pending: PendingVerification | null,
  now: Date,
  submittedHash: string
): ConfirmDecision {
  if (!pending) return { kind: 'no_pending' };
  if (Date.parse(pending.expiresAt) <= now.getTime()) return { kind: 'expired' };
  if (pending.attempts > MAX_CONFIRM_ATTEMPTS) return { kind: 'too_many_attempts' };
  if (constantTimeEqual(pending.codeHash, submittedHash)) return { kind: 'ok' };
  if (pending.attempts >= MAX_CONFIRM_ATTEMPTS) return { kind: 'too_many_attempts' };
  return { kind: 'wrong_code', attemptsLeft: MAX_CONFIRM_ATTEMPTS - pending.attempts };
}
