import { createHash } from 'crypto';
import {
  CODE_TTL_MS,
  MAX_CONFIRM_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  SEND_WINDOW_MS,
  checkSendAllowed,
  evaluateConfirm,
  generateVerificationCode,
  hashVerificationCode,
  type PendingVerification,
} from './phoneVerification';

const sha256Hex = async (input: string) => createHash('sha256').update(input).digest('hex');
const NOW = new Date('2026-10-15T02:00:00.000Z');

function pending(overrides: Partial<PendingVerification> = {}): PendingVerification {
  return {
    phoneE164: '+639171234567',
    codeHash: 'hash-of-123456',
    expiresAt: new Date(NOW.getTime() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    lastSentAt: new Date(NOW.getTime() - 120_000).toISOString(),
    sendsInWindow: 1,
    windowStartedAt: new Date(NOW.getTime() - 120_000).toISOString(),
    ...overrides,
  };
}

describe('generateVerificationCode', () => {
  it('returns six digits, zero-padded', () => {
    expect(generateVerificationCode(() => 123456789)).toBe('456789');
    expect(generateVerificationCode(() => 0)).toBe('000000');
    expect(generateVerificationCode(() => 42)).toBe('000042');
  });

  it('re-draws values that would bias the modulo', () => {
    const draws = [4294967295, 4294000000, 42];
    expect(generateVerificationCode(() => draws.shift() as number)).toBe('000042');
  });
});

describe('hashVerificationCode', () => {
  it('is deterministic and bound to the user, number and code', async () => {
    const base = await hashVerificationCode(sha256Hex, 'user-1', '+639171234567', '123456');
    expect(await hashVerificationCode(sha256Hex, 'user-1', '+639171234567', '123456')).toBe(base);
    expect(await hashVerificationCode(sha256Hex, 'user-2', '+639171234567', '123456')).not.toBe(base);
    expect(await hashVerificationCode(sha256Hex, 'user-1', '+639171234568', '123456')).not.toBe(base);
    expect(await hashVerificationCode(sha256Hex, 'user-1', '+639171234567', '123457')).not.toBe(base);
    expect(base).not.toContain('123456');
  });
});

describe('checkSendAllowed', () => {
  it('allows the first send and opens a window', () => {
    expect(checkSendAllowed(null, NOW)).toEqual({
      allowed: true,
      sendsInWindow: 1,
      windowStartedAt: NOW.toISOString(),
    });
  });

  it('blocks a resend inside the 60 second cooldown and says how long to wait', () => {
    const result = checkSendAllowed(pending({ lastSentAt: new Date(NOW.getTime() - 20_000).toISOString() }), NOW);
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it('allows a resend after the cooldown and counts it', () => {
    const result = checkSendAllowed(pending({ sendsInWindow: 2 }), NOW);
    expect(result).toEqual({
      allowed: true,
      sendsInWindow: 3,
      windowStartedAt: pending().windowStartedAt,
    });
  });

  it('blocks after the per-hour limit and reports when the window reopens', () => {
    const windowStartedAt = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const result = checkSendAllowed(
      pending({ sendsInWindow: MAX_SENDS_PER_WINDOW, windowStartedAt }),
      NOW
    );
    expect(result).toEqual({ allowed: false, retryAfterSeconds: 30 * 60 });
  });

  it('starts a fresh window once the hour has passed', () => {
    const windowStartedAt = new Date(NOW.getTime() - SEND_WINDOW_MS - 1000).toISOString();
    const result = checkSendAllowed(
      pending({ sendsInWindow: MAX_SENDS_PER_WINDOW, windowStartedAt, lastSentAt: windowStartedAt }),
      NOW
    );
    expect(result).toEqual({ allowed: true, sendsInWindow: 1, windowStartedAt: NOW.toISOString() });
  });
});

describe('evaluateConfirm', () => {
  it('reports no pending code', () => {
    expect(evaluateConfirm(null, NOW, 'x')).toEqual({ kind: 'no_pending' });
  });

  it('rejects an expired code even if it matches', () => {
    const expired = pending({ attempts: 1, expiresAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(evaluateConfirm(expired, NOW, 'hash-of-123456')).toEqual({ kind: 'expired' });
  });

  it('accepts the matching code', () => {
    expect(evaluateConfirm(pending({ attempts: 1 }), NOW, 'hash-of-123456')).toEqual({ kind: 'ok' });
  });

  it('counts down remaining attempts on a wrong code', () => {
    expect(evaluateConfirm(pending({ attempts: 1 }), NOW, 'nope')).toEqual({ kind: 'wrong_code', attemptsLeft: 4 });
    expect(evaluateConfirm(pending({ attempts: 4 }), NOW, 'nope')).toEqual({ kind: 'wrong_code', attemptsLeft: 1 });
  });

  it('burns the code on the fifth wrong attempt', () => {
    expect(evaluateConfirm(pending({ attempts: MAX_CONFIRM_ATTEMPTS }), NOW, 'nope')).toEqual({
      kind: 'too_many_attempts',
    });
  });

  it('still accepts a correct code on the last allowed attempt', () => {
    expect(evaluateConfirm(pending({ attempts: MAX_CONFIRM_ATTEMPTS }), NOW, 'hash-of-123456')).toEqual({ kind: 'ok' });
  });

  it('never accepts anything beyond the attempt limit, even the right code', () => {
    expect(evaluateConfirm(pending({ attempts: MAX_CONFIRM_ATTEMPTS + 1 }), NOW, 'hash-of-123456')).toEqual({
      kind: 'too_many_attempts',
    });
  });
});
