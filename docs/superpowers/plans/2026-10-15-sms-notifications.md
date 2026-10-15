# SMS Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the daily expiry digest by SMS (TextBee Android gateway) to opted-in members with a verified Philippine mobile number, next to the existing email digest.

**Architecture:** Pure, jest-tested logic (phone normalization, SMS text, provider, verification rules) lives in self-contained `packages/core` modules that the Deno Edge Functions import by relative path. A new `sms-verify` Edge Function proves number ownership with a 6-digit code. `compute-and-send-reminders` is split into independent email and SMS blocks, with per-household/user/day dedupe in a new `notification_deliveries` table. The web settings modal and admin settings page get the new controls.

**Tech Stack:** TypeScript, jest + ts-jest (`packages/core`, `packages/supabase-client`), Supabase (Postgres, RLS, Edge Functions on Deno, pg_cron), Next.js web app, TextBee REST API.

**Spec:** `docs/superpowers/specs/2026-10-15-sms-notifications-design.md`

## Global Constraints

- Philippine mobile numbers only, stored as `+639XXXXXXXXX` (regex `^\+639\d{9}$`). Enforced in the web form, in both Edge Functions, in the provider, and by database CHECK constraints.
- Only a verified number (a row in `user_phone_numbers`) ever receives a digest.
- The SMS provider is swappable: callers depend on the `SmsProvider` interface, never on TextBee directly.
- Web only. Mobile work is paused; do not touch `apps/mobile`.
- Telegram is out of scope.
- All dates for dedupe use the Asia/Manila calendar date, as the email digest already does.
- Every module in `packages/core/src` that an Edge Function imports must be self-contained (no relative imports). Deno needs explicit `.ts` extensions on relative imports, which jest and the other packages do not use.
- Tests that send a real SMS go only to the repo owner's own number. Never invent or guess a phone number.
- Do not stage `apps/web/next.config.js`: it has an unrelated uncommitted change. Stage files by explicit path.
- End every commit message with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Push to GitHub (`git push origin main`) after each completed task; the repo owner works from another machine.
- Deploying migrations, secrets, or Edge Functions to the linked Supabase project affects live data. Task 10 lists those steps; ask the user before running any of them.

## Review Focus

1. **Odd number formats and non-PH numbers.** `+63 917 123 4567`, `(0917) 123 4567`, `0917-123-4567` must normalize. `+1 202…`, landlines, too-short and too-long numbers must be rejected and never reach the provider. Pinned in Tasks 1 and 3 and checked in Task 7.
2. **SMS fails while email succeeds, or email was already sent today.** SMS must still be attempted and retried the same day, and email behavior must not change. Verified manually in Task 8.
3. **Wrong, expired, replayed, or spammed verification codes.** Five wrong attempts burn the code, expired codes fail, resends are rate-limited. Pinned in Task 4.
4. **Household SMS on but global SMS off, or a member opted in who has no verified number or removed it.** No send, no crash, a clear status. Verified manually in Task 8.
5. **Very long item names or many items.** The SMS stays within 160 characters, is plain ASCII, and says how many items were left out. Pinned in Task 2.
6. **A member in two households.** They get one SMS per household per day, not one in total. Enforced by the delivery table key and checked in Task 8.

---

### Task 1: Philippine phone number normalization

**Files:**
- Create: `packages/core/src/phoneNumber.ts`
- Create: `packages/core/src/phoneNumber.test.ts`
- Modify: `packages/core/src/index.ts` (add one export line)

**Interfaces:**
- Produces: `normalizePhPhoneNumber(input: string): string | null` (returns `+639XXXXXXXXX` or `null`) and `isPhMobileE164(value: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/phoneNumber.test.ts`:

```ts
import { normalizePhPhoneNumber, isPhMobileE164 } from './phoneNumber';

describe('normalizePhPhoneNumber', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['9171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
    ['+63 917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
    ['(0917) 123 4567', '+639171234567'],
    ['  +639171234567  ', '+639171234567'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhPhoneNumber(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['+12025550123'], // US
    ['+442071234567'], // UK
    ['+6591234567'], // Singapore
    ['+63281234567'], // Manila landline
    ['02-8123-4567'], // Manila landline, local form
    ['+63917123456'], // too short
    ['+6391712345678'], // too long
    ['0817123456'], // not a 09 mobile prefix
    ['09171234567x'], // trailing junk
    ['+639171234567 ext 5'], // extension
    ['٠٩١٧١٢٣٤٥٦٧'], // Arabic-Indic digits
    ['０９１７１２３４５６７'], // full-width digits
  ])('rejects %j', (input) => {
    expect(normalizePhPhoneNumber(input)).toBeNull();
  });
});

describe('isPhMobileE164', () => {
  it('accepts only the normalized form', () => {
    expect(isPhMobileE164('+639171234567')).toBe(true);
    expect(isPhMobileE164('09171234567')).toBe(false);
    expect(isPhMobileE164('+12025550123')).toBe(false);
    expect(isPhMobileE164('+6391712345678')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest src/phoneNumber.test.ts`
Expected: FAIL with "Cannot find module './phoneNumber'".

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/phoneNumber.ts`:

```ts
// Philippine mobile numbers only. This module must stay import-free: the
// Supabase Edge Functions import it directly by relative path (Deno needs
// explicit .ts extensions there, which the other packages don't use).

const PH_MOBILE_E164 = /^\+639\d{9}$/;

export function isPhMobileE164(value: string): boolean {
  return PH_MOBILE_E164.test(value);
}

/**
 * Normalizes the ways people type a Philippine mobile number into
 * `+639XXXXXXXXX`. Returns null for anything else — other countries,
 * landlines, wrong lengths, stray characters.
 */
export function normalizePhPhoneNumber(input: string): string | null {
  const stripped = input.trim().replace(/[\s\-().]/g, '');

  let nationalNumber: string;
  if (/^\+639\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(3);
  } else if (/^639\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(2);
  } else if (/^09\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(1);
  } else if (/^9\d{9}$/.test(stripped)) {
    nationalNumber = stripped;
  } else {
    return null;
  }

  return `+63${nationalNumber}`;
}
```

Add to `packages/core/src/index.ts` (after the `notificationDigest` export line):

```ts
export * from './phoneNumber';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx jest src/phoneNumber.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/phoneNumber.ts packages/core/src/phoneNumber.test.ts packages/core/src/index.ts
git commit -m "feat(core): add Philippine phone number normalization

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: SMS digest text

**Files:**
- Create: `packages/core/src/digestSms.ts`
- Create: `packages/core/src/digestSms.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `interface SmsDigestItem { name: string; daysUntilExpiry: number }`, `interface SmsDigestInput { householdName: string; items: SmsDigestItem[] }`, `buildDigestSms(input: SmsDigestInput): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/digestSms.test.ts`:

```ts
import { buildDigestSms } from './digestSms';

const FOOTER = '. Open the app for details.';

describe('buildDigestSms', () => {
  it('lists items soonest first with short day labels', () => {
    const text = buildDigestSms({
      householdName: 'The Gos',
      items: [
        { name: 'Rice', daysUntilExpiry: 5 },
        { name: 'Milk', daysUntilExpiry: 0 },
        { name: 'Eggs', daysUntilExpiry: 2 },
      ],
    });
    expect(text).toBe('Pantry (The Gos): Milk today, Eggs in 2d, Rice in 5d' + FOOTER);
  });

  it('labels tomorrow and expired items', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [
        { name: 'Bread', daysUntilExpiry: -2 },
        { name: 'Yogurt', daysUntilExpiry: 1 },
      ],
    });
    expect(text).toBe('Pantry (Home): Bread expired, Yogurt tomorrow' + FOOTER);
  });

  it('keeps long digests within 160 characters and says how many were left out', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `Imported gourmet item number ${i + 1}`,
      daysUntilExpiry: i,
    }));
    const text = buildDigestSms({ householdName: 'A Very Long Household Name Indeed', items });

    expect(text.length).toBeLessThanOrEqual(160);
    const more = /\+(\d+) more/.exec(text);
    expect(more).not.toBeNull();
    const shown = text.slice(text.indexOf(': ') + 2, text.indexOf(' +')).split(', ').length;
    expect(shown + Number(more![1])).toBe(30);
    expect(text.endsWith(FOOTER)).toBe(true);
  });

  it('truncates a very long household name', () => {
    const text = buildDigestSms({
      householdName: 'The Extraordinarily Long Household Name Of Doom',
      items: [{ name: 'Milk', daysUntilExpiry: 1 }],
    });
    expect(text.startsWith('Pantry (The Extraordinarily):')).toBe(true);
  });

  it('truncates a very long item name', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [{ name: 'x'.repeat(200), daysUntilExpiry: 1 }],
    });
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it('outputs plain ASCII, stripping accents, emoji and smart punctuation', () => {
    const text = buildDigestSms({
      householdName: 'Café Ñandú',
      items: [
        { name: 'Jalapeño “hot” 🌶️', daysUntilExpiry: 1 },
        { name: 'Crème fraîche', daysUntilExpiry: 2 },
      ],
    });
    expect(/^[\x20-\x7E]+$/.test(text)).toBe(true);
    expect(text).toContain('Jalapeno "hot"');
    expect(text).toContain('Creme fraiche');
    expect(text.startsWith('Pantry (Cafe Nandu):')).toBe(true);
  });

  it('never emits characters outside the GSM-7 basic set that force a 70-character message', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [{ name: 'Tea `bags` [box] {x} ~ | ^ \\', daysUntilExpiry: 1 }],
    });
    expect(/[`\[\]{}~|^\\]/.test(text)).toBe(false);
  });

  it('says so plainly when nothing is expiring', () => {
    expect(buildDigestSms({ householdName: 'Home', items: [] })).toBe('Pantry (Home): nothing expiring soon.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest src/digestSms.test.ts`
Expected: FAIL with "Cannot find module './digestSms'".

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/digestSms.ts`:

```ts
// Self-contained (no relative imports) so the Edge Functions can import it
// directly. Output is restricted to characters in the GSM-7 basic set so a
// message stays a single 160-character segment; one character outside it
// (an emoji, a backtick) re-encodes the whole message as 70-character UCS-2.

export interface SmsDigestItem {
  name: string;
  daysUntilExpiry: number;
}

export interface SmsDigestInput {
  householdName: string;
  items: SmsDigestItem[];
}

const MAX_LENGTH = 160;
const MAX_HOUSEHOLD_NAME_LENGTH = 20;
const MAX_ITEM_NAME_LENGTH = 40;
const FOOTER = '. Open the app for details.';

function toGsmSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 @$!"#%&'()*+,\-./:;<=>?_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeDays(days: number): string {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export function buildDigestSms(input: SmsDigestInput): string {
  const household = toGsmSafe(input.householdName).slice(0, MAX_HOUSEHOLD_NAME_LENGTH).trim();
  const head = `Pantry (${household}): `;

  if (input.items.length === 0) {
    return `Pantry (${household}): nothing expiring soon.`;
  }

  const labels = [...input.items]
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
    .map((item) => `${toGsmSafe(item.name).slice(0, MAX_ITEM_NAME_LENGTH).trim()} ${describeDays(item.daysUntilExpiry)}`);

  let shown = 1;
  for (let count = 1; count <= labels.length; count += 1) {
    const remaining = labels.length - count;
    const candidate = head + labels.slice(0, count).join(', ') + (remaining > 0 ? ` +${remaining} more` : '') + FOOTER;
    if (candidate.length > MAX_LENGTH) break;
    shown = count;
  }

  const remaining = labels.length - shown;
  return head + labels.slice(0, shown).join(', ') + (remaining > 0 ? ` +${remaining} more` : '') + FOOTER;
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './digestSms';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx jest src/digestSms.test.ts`
Expected: PASS. If the "long digests" test fails on the `shown` count, print `text` and check that the `' +'` search matches the first `+N more`, not a `+` inside an item name (names are sanitized but may contain `+`; the test names do not).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/digestSms.ts packages/core/src/digestSms.test.ts packages/core/src/index.ts
git commit -m "feat(core): add SMS digest text builder

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: SMS provider interface and TextBee implementation

**Files:**
- Create: `packages/core/src/smsProvider.ts`
- Create: `packages/core/src/smsProvider.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `isPhMobileE164` from Task 1 (test only; the provider carries its own copy of the regex, see the comment in the code).
- Produces:
  - `type SmsSendResult = { ok: true; id?: string } | { ok: false; error: string }`
  - `interface SmsProvider { send(input: { to: string; text: string }): Promise<SmsSendResult> }`
  - `type FetchLike`, `interface SmsProviderEnv { SMS_PROVIDER?: string; TEXTBEE_API_KEY?: string }`
  - `createTextBeeProvider(options: { apiKey: string; fetchImpl: FetchLike; baseUrl?: string }): SmsProvider`
  - `createSmsProvider(env: SmsProviderEnv, fetchImpl: FetchLike): SmsProvider` (throws on a missing key or unknown provider)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/smsProvider.test.ts`:

```ts
import { createSmsProvider, createTextBeeProvider, type FetchLike } from './smsProvider';
import { isPhMobileE164 } from './phoneNumber';

function fakeFetch(response: { ok: boolean; status: number; body: string }) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, text: async () => response.body };
  };
  return { fetchImpl, calls };
}

describe('createTextBeeProvider', () => {
  it('posts the recipient and message with the API key header', async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 201, body: JSON.stringify({ data: { _id: 'msg-1' } }) });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });

    const result = await provider.send({ to: '+639171234567', text: 'hello' });

    expect(result).toEqual({ ok: true, id: 'msg-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['x-api-key']).toBe('secret');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body)).toEqual({ recipients: ['+639171234567'], message: 'hello' });
  });

  it('succeeds without an id when the response body is not the expected shape', async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: 'not json' });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    expect(await provider.send({ to: '+639171234567', text: 'hi' })).toEqual({ ok: true, id: undefined });
  });

  it('reports HTTP errors with the status and a truncated body', async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 429, body: 'x'.repeat(500) });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    const result = await provider.send({ to: '+639171234567', text: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith('TextBee 429: ')).toBe(true);
      expect(result.error.length).toBeLessThanOrEqual('TextBee 429: '.length + 200);
    }
  });

  it('reports network failures instead of throwing', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    expect(await provider.send({ to: '+639171234567', text: 'hi' })).toEqual({ ok: false, error: 'socket hang up' });
  });

  it.each(['+12025550123', '09171234567', '+63281234567', '', '+6391712345678'])(
    'refuses %j without calling the gateway',
    async (to) => {
      const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: '{}' });
      const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
      const result = await provider.send({ to, text: 'hi' });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
    }
  );

  it('uses the same recipient rule as isPhMobileE164', async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: '{}' });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    for (const candidate of ['+639171234567', '+639999999999', '+6391712345', '+639abcdefghi', '639171234567']) {
      calls.length = 0;
      await provider.send({ to: candidate, text: 'hi' });
      expect(calls.length === 1).toBe(isPhMobileE164(candidate));
    }
  });
});

describe('createSmsProvider', () => {
  const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: '{}' });

  it('defaults to TextBee', () => {
    expect(() => createSmsProvider({ TEXTBEE_API_KEY: 'k' }, fetchImpl)).not.toThrow();
  });

  it('requires the TextBee API key', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'textbee' }, fetchImpl)).toThrow('TEXTBEE_API_KEY is not set');
  });

  it('rejects an unknown provider name', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'carrier-pigeon', TEXTBEE_API_KEY: 'k' }, fetchImpl)).toThrow(
      'Unknown SMS_PROVIDER: carrier-pigeon'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest src/smsProvider.test.ts`
Expected: FAIL with "Cannot find module './smsProvider'".

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/smsProvider.ts`:

```ts
// Self-contained (no relative imports) so the Edge Functions can import it
// directly. `fetch` is injected so jest can test it without a network.

export type SmsSendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface SmsSendInput {
  to: string;
  text: string;
}

export interface SmsProvider {
  send(input: SmsSendInput): Promise<SmsSendResult>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<FetchResponseLike>;

export interface SmsProviderEnv {
  SMS_PROVIDER?: string;
  TEXTBEE_API_KEY?: string;
}

// Same rule as isPhMobileE164 in phoneNumber.ts. Duplicated on purpose so this
// module stays import-free; smsProvider.test.ts pins the two together. The
// provider is the last gate before a real SMS leaves the building, so it
// refuses non-Philippine recipients itself instead of trusting its callers.
const PH_MOBILE_E164 = /^\+639\d{9}$/;

function extractMessageId(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.data?._id ?? parsed?.data?.id ?? parsed?._id ?? parsed?.id;
    return typeof candidate === 'string' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function createTextBeeProvider(options: {
  apiKey: string;
  fetchImpl: FetchLike;
  baseUrl?: string;
}): SmsProvider {
  const baseUrl = options.baseUrl ?? 'https://api.textbee.dev';
  return {
    async send({ to, text }) {
      if (!PH_MOBILE_E164.test(to)) {
        return { ok: false, error: 'Refusing to send: recipient is not a Philippine mobile number.' };
      }
      try {
        const response = await options.fetchImpl(`${baseUrl}/api/v1/gateway/send-sms`, {
          method: 'POST',
          headers: { 'x-api-key': options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients: [to], message: text }),
        });
        const raw = await response.text();
        if (!response.ok) {
          return { ok: false, error: `TextBee ${response.status}: ${raw.slice(0, 200)}` };
        }
        return { ok: true, id: extractMessageId(raw) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function createSmsProvider(env: SmsProviderEnv, fetchImpl: FetchLike): SmsProvider {
  const name = (env.SMS_PROVIDER ?? 'textbee').trim().toLowerCase();
  if (name === 'textbee') {
    if (!env.TEXTBEE_API_KEY) throw new Error('TEXTBEE_API_KEY is not set');
    return createTextBeeProvider({ apiKey: env.TEXTBEE_API_KEY, fetchImpl });
  }
  throw new Error(`Unknown SMS_PROVIDER: ${name}`);
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './smsProvider';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/core && npx jest src/smsProvider.test.ts && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/smsProvider.ts packages/core/src/smsProvider.test.ts packages/core/src/index.ts
git commit -m "feat(core): add SMS provider interface with TextBee implementation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Phone verification rules

**Files:**
- Create: `packages/core/src/phoneVerification.ts`
- Create: `packages/core/src/phoneVerification.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - constants `CODE_TTL_MS`, `MAX_CONFIRM_ATTEMPTS`, `RESEND_COOLDOWN_MS`, `SEND_WINDOW_MS`, `MAX_SENDS_PER_WINDOW`
  - `generateVerificationCode(randomUint32: () => number): string`
  - `hashVerificationCode(sha256Hex: (input: string) => Promise<string>, userId: string, phone: string, code: string): Promise<string>`
  - `interface PendingVerification { phoneE164: string; codeHash: string; expiresAt: string; attempts: number; lastSentAt: string; sendsInWindow: number; windowStartedAt: string }`
  - `checkSendAllowed(pending: PendingVerification | null, now: Date): { allowed: true; sendsInWindow: number; windowStartedAt: string } | { allowed: false; retryAfterSeconds: number }`
  - `type ConfirmDecision = { kind: 'ok' } | { kind: 'no_pending' } | { kind: 'expired' } | { kind: 'too_many_attempts' } | { kind: 'wrong_code'; attemptsLeft: number }`
  - `evaluateConfirm(pending: PendingVerification | null, now: Date, submittedHash: string): ConfirmDecision` (`pending.attempts` is the count after this attempt has been recorded)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/phoneVerification.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && npx jest src/phoneVerification.test.ts`
Expected: FAIL with "Cannot find module './phoneVerification'".

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/phoneVerification.ts`:

```ts
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
```

Add to `packages/core/src/index.ts`:

```ts
export * from './phoneVerification';
```

- [ ] **Step 4: Run all core tests and the type check**

Run: `cd packages/core && npx jest && npx tsc --noEmit`
Expected: PASS for the whole core suite and no type errors. (`crypto` import in the test needs `@types/node`; if `tsc` complains, check that it is installed at the repo root and add `"types": ["node", "jest"]` to nothing — do not change tsconfig; instead report the error.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/phoneVerification.ts packages/core/src/phoneVerification.test.ts packages/core/src/index.ts
git commit -m "feat(core): add phone verification rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Database migration and type updates

**Files:**
- Create: `supabase/migrations/20261015000001_sms_notifications.sql`
- Modify: `packages/supabase-client/src/types.ts` (hand-maintained, not generated)

**Interfaces:**
- Produces (database): tables `user_phone_numbers`, `phone_verifications`, `notification_deliveries`; columns `household_members.sms_enabled`, `households.sms_enabled`, `app_settings.sms_notifications_enabled`; RPC `increment_phone_verification_attempts(p_user_id uuid)` returning `setof phone_verifications` (service role only); `trigger_due_household_reminders()` redefined to dispatch while either email or SMS is globally enabled.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261015000001_sms_notifications.sql`:

```sql
-- supabase/migrations/20261015000001_sms_notifications.sql

-- =========================================================
-- VERIFIED PHONE NUMBERS
-- One per user. Written only by the sms-verify Edge Function (service role,
-- after the user proves ownership with a code). Users may read and delete
-- their own row; no insert/update policy exists on purpose.
-- =========================================================
create table user_phone_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+639\d{9}$'),
  verified_at timestamptz not null default now()
);

alter table user_phone_numbers enable row level security;

create policy "users can read their own phone number"
  on user_phone_numbers for select
  using (user_id = auth.uid());

create policy "users can delete their own phone number"
  on user_phone_numbers for delete
  using (user_id = auth.uid());

comment on table user_phone_numbers is
  'Verified Philippine mobile number per user (+639XXXXXXXXX). Inserted/updated only by the sms-verify Edge Function after a successful code confirmation.';

-- =========================================================
-- PENDING VERIFICATION CODES
-- RLS on with no policies: only the service role can touch it.
-- =========================================================
create table phone_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+639\d{9}$'),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  last_sent_at timestamptz not null default now(),
  sends_in_window smallint not null default 1,
  window_started_at timestamptz not null default now()
);

alter table phone_verifications enable row level security;

comment on table phone_verifications is
  'One pending SMS verification per user. Holds a SHA-256 hash of the code, never the code itself. Service-role only (no RLS policies).';

-- Atomic attempt counter: the Edge Function increments before comparing so
-- concurrent guesses cannot share a single attempt.
create or replace function increment_phone_verification_attempts(p_user_id uuid)
returns setof phone_verifications
language sql
security definer
set search_path = pg_catalog, public
as $$
  update phone_verifications
  set attempts = attempts + 1
  where user_id = p_user_id
  returning *;
$$;

revoke execute on function increment_phone_verification_attempts(uuid) from public, anon, authenticated;
grant execute on function increment_phone_verification_attempts(uuid) to service_role;

-- =========================================================
-- OPT-IN SWITCHES
-- =========================================================
alter table household_members
  add column sms_enabled boolean not null default false;

comment on column household_members.sms_enabled is
  'Member opted in to the daily digest by SMS. Only takes effect when the household switch, the global switch and a verified phone number are all present.';

alter table households
  add column sms_enabled boolean not null default false;

comment on column households.sms_enabled is
  'Owner/admin switch that makes SMS available for this household. Members still opt in individually.';

alter table app_settings
  add column sms_notifications_enabled boolean not null default false;

-- Existing policies already cover these columns: "members can update their
-- own notification setting" (household_members), "owners/admins can update
-- household" (households) and "admins can update app settings" (app_settings).

-- =========================================================
-- DELIVERY LOG + PER-DAY DEDUPE
-- The household is part of the key so a member of two households gets both
-- digests. Written only by the Edge Function (service role).
-- =========================================================
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('sms')),
  digest_date date not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (household_id, user_id, channel, digest_date)
);

create index idx_notification_deliveries_household_date
  on notification_deliveries(household_id, digest_date);

alter table notification_deliveries enable row level security;

create policy "owners and admins can read their household's deliveries"
  on notification_deliveries for select
  using (is_household_admin_or_owner(household_id));

comment on table notification_deliveries is
  'Per-channel send log. The unique key makes a same-day retry skip members who already received the digest.';

-- =========================================================
-- CRON DISPATCH
-- Redefined from 20260928000001_app_settings_email_toggle.sql: it used to
-- return early whenever email was globally off, which would also stop SMS.
-- Now it only skips dispatch when BOTH channels are globally off.
-- =========================================================
create or replace function trigger_due_household_reminders()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household record;
  v_service_key text;
begin
  if not coalesce(
    (select email_notifications_enabled or sms_notifications_enabled from app_settings where id),
    true
  ) then
    return;
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise warning 'service_role_key not found in Vault; skipping reminder dispatch';
    return;
  end if;

  for v_household in
    select id
    from households
    where mod(
      extract(epoch from ((now() at time zone 'Asia/Manila')::time - notify_email_send_time))::int + 86400,
      86400
    ) < 900
  loop
    perform net.http_post(
      url := 'https://nrjeqeddlssrxaskovrs.supabase.co/functions/v1/compute-and-send-reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('household_id', v_household.id)
    );
  end loop;
end;
$$;
```

- [ ] **Step 2: Update the hand-maintained types**

In `packages/supabase-client/src/types.ts`:

1. In the `households` `Row`, after `last_digest_sent_date: string | null;` add:

```ts
          sms_enabled: boolean;
```

2. In the `household_members` `Row`, after `notifications_enabled: boolean;` add:

```ts
          sms_enabled: boolean;
```

3. In the `app_settings` `Row`, after `email_notifications_enabled: boolean;` add:

```ts
          sms_notifications_enabled: boolean;
```

4. Add two new tables inside `Tables`, directly after the `app_settings` block (the one ending in `Relationships: [];\n      };` before `access_applications`):

```ts
      user_phone_numbers: {
        Row: {
          user_id: string;
          phone_e164: string;
          verified_at: string;
        };
        Insert: Partial<Database['public']['Tables']['user_phone_numbers']['Row']> & {
          user_id: string;
          phone_e164: string;
        };
        Update: Partial<Database['public']['Tables']['user_phone_numbers']['Row']>;
        Relationships: [];
      };
      notification_deliveries: {
        Row: {
          id: string;
          household_id: string;
          user_id: string;
          channel: 'sms';
          digest_date: string;
          status: 'sent' | 'failed';
          provider_message_id: string | null;
          error: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['notification_deliveries']['Row']> & {
          household_id: string;
          user_id: string;
          channel: 'sms';
          digest_date: string;
          status: 'sent' | 'failed';
        };
        Update: Partial<Database['public']['Tables']['notification_deliveries']['Row']>;
        Relationships: [];
      };
```

`phone_verifications` is service-role only and is deliberately not in the client types.

- [ ] **Step 3: Type-check the packages that use these types**

Run: `cd packages/supabase-client && npx tsc --noEmit`
Expected: no errors. (Existing code that builds `Insert` objects for `households`/`household_members` uses `Partial<Row> & {…}`, so the new columns do not break it.)

- [ ] **Step 4: Verify the migration (ask the user first)**

Do not apply this to the linked project without the user's go-ahead (it is live data, and the redefined cron function is in production use). When approved, run the whole file in the Supabase SQL editor, then run these checks inside a transaction that is rolled back:

```sql
begin;
-- each of these must fail with a check-constraint violation:
insert into user_phone_numbers (user_id, phone_e164)
  values ((select id from auth.users limit 1), '+12025550123');
insert into user_phone_numbers (user_id, phone_e164)
  values ((select id from auth.users limit 1), '09171234567');
rollback;

begin;
-- must succeed:
insert into user_phone_numbers (user_id, phone_e164)
  values ((select id from auth.users limit 1), '+639171234567');
rollback;
```

Expected: the first block errors with `violates check constraint`; the second succeeds. Also confirm `select proname from pg_proc where proname = 'increment_phone_verification_attempts';` returns a row, and that `select sms_enabled from households limit 1;` returns `false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261015000001_sms_notifications.sql packages/supabase-client/src/types.ts
git commit -m "feat(db): add SMS notification tables, switches and verification RPC

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: Supabase client wrappers

**Files:**
- Create: `packages/supabase-client/src/sms.ts`
- Create: `packages/supabase-client/src/sms.test.ts`
- Modify: `packages/supabase-client/src/appSettings.ts`
- Create: `packages/supabase-client/src/appSettings.test.ts`
- Modify: `packages/supabase-client/src/reminders.ts` (return type of `triggerRemindersNow`)
- Modify: `packages/supabase-client/src/index.ts`

**Interfaces:**
- Consumes: the tables and columns from Task 5; the `sms-verify` Edge Function from Task 7 (request `{ action: 'request', phone }` returns `{ status: 'sent' }`; request `{ action: 'confirm', code }` returns `{ status: 'verified', phone_e164 }`; errors carry `{ error: string }`).
- Produces:
  - `getMyPhoneNumber(client, userId): Promise<{ phoneE164: string; verifiedAt: string } | null>`
  - `removeMyPhoneNumber(client, userId): Promise<void>`
  - `requestPhoneVerification(client, phone: string): Promise<void>`
  - `confirmPhoneVerification(client, code: string): Promise<{ phoneE164: string }>`
  - `getMemberSmsEnabled(client, householdId, userId): Promise<boolean>` and `setMemberSmsEnabled(client, householdId, userId, enabled): Promise<void>`
  - `getHouseholdSmsEnabled(client, householdId): Promise<boolean>` and `setHouseholdSmsEnabled(client, householdId, enabled): Promise<void>`
  - `AppSettings` gains `smsNotificationsEnabled: boolean`; new `setSmsNotificationsEnabled(client, enabled, updatedBy): Promise<void>`
  - `triggerRemindersNow` returns `Promise<{ status: string; sms?: { status: string } }>`

- [ ] **Step 1: Write the failing tests**

Create `packages/supabase-client/src/sms.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  confirmPhoneVerification,
  getHouseholdSmsEnabled,
  getMemberSmsEnabled,
  getMyPhoneNumber,
  removeMyPhoneNumber,
  requestPhoneVerification,
  setHouseholdSmsEnabled,
  setMemberSmsEnabled,
} from './sms';

type Result = { data: any; error: any };

// A chainable stand-in for the PostgREST builder: every method returns the
// builder, and awaiting it (or calling .single()/.maybeSingle()) yields the
// canned result. Records each call so tests can assert the query shape.
function fakeClient(result: Result) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, unknown[]][] };
      calls.push(entry);
      const builder: any = {};
      for (const op of ['select', 'update', 'delete', 'eq']) {
        builder[op] = (...args: unknown[]) => {
          entry.ops.push([op, args]);
          return builder;
        };
      }
      builder.single = async () => result;
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('getMyPhoneNumber', () => {
  it('maps the row, or returns null when there is no number', async () => {
    const { client } = fakeClient({
      data: { phone_e164: '+639171234567', verified_at: '2026-10-15T00:00:00Z' },
      error: null,
    });
    expect(await getMyPhoneNumber(client, 'user-1')).toEqual({
      phoneE164: '+639171234567',
      verifiedAt: '2026-10-15T00:00:00Z',
    });
    expect(await getMyPhoneNumber(fakeClient({ data: null, error: null }).client, 'user-1')).toBeNull();
  });

  it('throws on a query error', async () => {
    await expect(getMyPhoneNumber(fakeClient({ data: null, error: new Error('boom') }).client, 'u')).rejects.toThrow('boom');
  });
});

describe('removeMyPhoneNumber', () => {
  it('deletes only the caller’s row', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await removeMyPhoneNumber(client, 'user-1');
    expect(calls[0].table).toBe('user_phone_numbers');
    expect(calls[0].ops).toContainEqual(['eq', ['user_id', 'user-1']]);
    expect(calls[0].ops.some(([op]) => op === 'delete')).toBe(true);
  });
});

describe('phone verification calls', () => {
  function invokeClient(response: { data: any; error: any }) {
    const invoke = jest.fn(async () => response);
    return { client: { functions: { invoke } } as unknown as SupabaseClient<Database>, invoke };
  }

  it('requests a code through the sms-verify function', async () => {
    const { client, invoke } = invokeClient({ data: { status: 'sent' }, error: null });
    await requestPhoneVerification(client, '09171234567');
    expect(invoke).toHaveBeenCalledWith('sms-verify', { body: { action: 'request', phone: '09171234567' } });
  });

  it('confirms a code and returns the verified number', async () => {
    const { client, invoke } = invokeClient({
      data: { status: 'verified', phone_e164: '+639171234567' },
      error: null,
    });
    expect(await confirmPhoneVerification(client, '123456')).toEqual({ phoneE164: '+639171234567' });
    expect(invoke).toHaveBeenCalledWith('sms-verify', { body: { action: 'confirm', code: '123456' } });
  });

  it('surfaces the server’s error message instead of the generic one', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { json: async () => ({ error: 'Please wait 40 seconds before requesting another code.' }) },
    });
    const { client } = invokeClient({ data: null, error });
    await expect(requestPhoneVerification(client, '09171234567')).rejects.toThrow(
      'Please wait 40 seconds before requesting another code.'
    );
  });

  it('falls back to the generic message when the error body is not JSON', async () => {
    const error = Object.assign(new Error('generic failure'), {
      context: {
        json: async () => {
          throw new Error('not json');
        },
      },
    });
    const { client } = invokeClient({ data: null, error });
    await expect(confirmPhoneVerification(client, '123456')).rejects.toThrow('generic failure');
  });
});

describe('member and household SMS switches', () => {
  it('reads the member switch', async () => {
    const { client, calls } = fakeClient({ data: { sms_enabled: true }, error: null });
    expect(await getMemberSmsEnabled(client, 'house-1', 'user-1')).toBe(true);
    expect(calls[0].table).toBe('household_members');
  });

  it('writes the member switch and fails when no row was updated', async () => {
    const ok = fakeClient({ data: [{ id: 'm1' }], error: null });
    await setMemberSmsEnabled(ok.client, 'house-1', 'user-1', true);
    expect(ok.calls[0].ops).toContainEqual(['update', [{ sms_enabled: true }]]);

    const none = fakeClient({ data: [], error: null });
    await expect(setMemberSmsEnabled(none.client, 'house-1', 'user-1', true)).rejects.toThrow(
      'Failed to update your SMS setting.'
    );
  });

  it('reads the household switch', async () => {
    const { client, calls } = fakeClient({ data: { sms_enabled: false }, error: null });
    expect(await getHouseholdSmsEnabled(client, 'house-1')).toBe(false);
    expect(calls[0].table).toBe('households');
  });

  it('writes the household switch and reports a permission failure when RLS filters it out', async () => {
    const ok = fakeClient({ data: [{ id: 'h1' }], error: null });
    await setHouseholdSmsEnabled(ok.client, 'house-1', true);
    expect(ok.calls[0].ops).toContainEqual(['update', [{ sms_enabled: true }]]);

    const none = fakeClient({ data: [], error: null });
    await expect(setHouseholdSmsEnabled(none.client, 'house-1', true)).rejects.toThrow(
      'You do not have permission to change SMS settings for this household.'
    );
  });
});
```

Create `packages/supabase-client/src/appSettings.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getAppSettings, setEmailNotificationsEnabled, setSmsNotificationsEnabled } from './appSettings';

function updateClient(result: { data: any; error: any }) {
  const update = jest.fn();
  const builder: any = {
    update: (patch: unknown) => {
      update(patch);
      return builder;
    },
    eq: () => builder,
    select: async () => result,
  };
  return { client: { from: () => builder } as unknown as SupabaseClient<Database>, update };
}

describe('getAppSettings', () => {
  it('maps both switches', async () => {
    const client = {
      from: () => ({
        select: () => ({
          single: async () => ({
            data: { email_notifications_enabled: true, sms_notifications_enabled: false },
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    expect(await getAppSettings(client)).toEqual({ emailNotificationsEnabled: true, smsNotificationsEnabled: false });
  });
});

describe('setSmsNotificationsEnabled', () => {
  it('updates only the SMS column and stamps who changed it', async () => {
    const { client, update } = updateClient({ data: [{ id: true }], error: null });
    await setSmsNotificationsEnabled(client, true, 'admin-1');
    const patch = update.mock.calls[0][0];
    expect(patch.sms_notifications_enabled).toBe(true);
    expect(patch.updated_by).toBe('admin-1');
    expect('email_notifications_enabled' in patch).toBe(false);
  });

  it('reports a permission failure when RLS filters the update out', async () => {
    const { client } = updateClient({ data: [], error: null });
    await expect(setSmsNotificationsEnabled(client, true, 'admin-1')).rejects.toThrow(
      'Setting was not updated — you do not have permission.'
    );
  });
});

describe('setEmailNotificationsEnabled', () => {
  it('still updates only the email column', async () => {
    const { client, update } = updateClient({ data: [{ id: true }], error: null });
    await setEmailNotificationsEnabled(client, false, 'admin-1');
    const patch = update.mock.calls[0][0];
    expect(patch.email_notifications_enabled).toBe(false);
    expect('sms_notifications_enabled' in patch).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest src/sms.test.ts src/appSettings.test.ts`
Expected: FAIL ("Cannot find module './sms'" and missing `setSmsNotificationsEnabled`).

- [ ] **Step 3: Write the implementation**

Create `packages/supabase-client/src/sms.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface PhoneNumberStatus {
  phoneE164: string;
  verifiedAt: string;
}

/** The caller's verified number, or null. RLS limits the table to their own row. */
export async function getMyPhoneNumber(
  client: SupabaseClient<Database>,
  userId: string
): Promise<PhoneNumberStatus | null> {
  const { data, error } = await client
    .from('user_phone_numbers')
    .select('phone_e164, verified_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { phoneE164: data.phone_e164, verifiedAt: data.verified_at };
}

export async function removeMyPhoneNumber(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await client.from('user_phone_numbers').delete().eq('user_id', userId);
  if (error) throw error;
}

// `functions.invoke` reports every non-2xx as a generic "Edge Function
// returned a non-2xx status code". The real reason ("wait 40 seconds", "not a
// Philippine number") is in the response body, so dig it out.
async function invokeSmsVerify<T>(client: SupabaseClient<Database>, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('sms-verify', { body });
  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const payload = (await context?.json?.()) as { error?: string } | undefined;
      if (payload?.error) message = payload.error;
    } catch {
      // The body wasn't JSON — keep the generic message.
    }
    throw new Error(message);
  }
  return data as T;
}

export async function requestPhoneVerification(client: SupabaseClient<Database>, phone: string): Promise<void> {
  await invokeSmsVerify(client, { action: 'request', phone });
}

export async function confirmPhoneVerification(
  client: SupabaseClient<Database>,
  code: string
): Promise<{ phoneE164: string }> {
  const data = await invokeSmsVerify<{ phone_e164: string }>(client, { action: 'confirm', code });
  return { phoneE164: data.phone_e164 };
}

export async function getMemberSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('household_members')
    .select('sms_enabled')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data.sms_enabled;
}

export async function setMemberSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const { data, error } = await client
    .from('household_members')
    .update({ sms_enabled: enabled })
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to update your SMS setting.');
  }
}

export async function getHouseholdSmsEnabled(client: SupabaseClient<Database>, householdId: string): Promise<boolean> {
  const { data, error } = await client.from('households').select('sms_enabled').eq('id', householdId).single();
  if (error) throw error;
  return data.sms_enabled;
}

export async function setHouseholdSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  enabled: boolean
): Promise<void> {
  // `.select()` matters: RLS restricts households UPDATE to owners/admins, and
  // an update that matches zero rows comes back as { data: [], error: null }.
  const { data, error } = await client
    .from('households')
    .update({ sms_enabled: enabled })
    .eq('id', householdId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('You do not have permission to change SMS settings for this household.');
  }
}
```

Replace the whole of `packages/supabase-client/src/appSettings.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AppSettings {
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
}

/** App-wide settings, readable/writable by platform admins only (see app_settings RLS policies). */
export async function getAppSettings(client: SupabaseClient<Database>): Promise<AppSettings> {
  const { data, error } = await client
    .from('app_settings')
    .select('email_notifications_enabled, sms_notifications_enabled')
    .single();
  if (error) throw error;
  return {
    emailNotificationsEnabled: data.email_notifications_enabled,
    smsNotificationsEnabled: data.sms_notifications_enabled,
  };
}

async function updateAppSettings(
  client: SupabaseClient<Database>,
  patch: { email_notifications_enabled: boolean } | { sms_notifications_enabled: boolean },
  updatedBy: string
): Promise<void> {
  // `.select()` matters here for the same reason it does in
  // updateHouseholdNotificationPrefs/deleteHousehold: RLS can silently
  // filter an update down to zero affected rows (unauthorized caller),
  // which comes back as { data: null, error: null } — a false "success"
  // the UI would otherwise report as done.
  const { data, error } = await client
    .from('app_settings')
    .update({ ...patch, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Setting was not updated — you do not have permission.');
  }
}

export async function setEmailNotificationsEnabled(
  client: SupabaseClient<Database>,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await updateAppSettings(client, { email_notifications_enabled: enabled }, updatedBy);
}

export async function setSmsNotificationsEnabled(
  client: SupabaseClient<Database>,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  await updateAppSettings(client, { sms_notifications_enabled: enabled }, updatedBy);
}
```

In `packages/supabase-client/src/reminders.ts`, change the return type of `triggerRemindersNow` from `Promise<{ status: string }>` to:

```ts
): Promise<{ status: string; sms?: { status: string } }> {
```

In `packages/supabase-client/src/index.ts` add:

```ts
export * from './sms';
```

- [ ] **Step 4: Run the tests and type check**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: PASS for the whole package, no type errors. The existing `reminders.test.ts` must still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/supabase-client/src/sms.ts packages/supabase-client/src/sms.test.ts packages/supabase-client/src/appSettings.ts packages/supabase-client/src/appSettings.test.ts packages/supabase-client/src/reminders.ts packages/supabase-client/src/index.ts
git commit -m "feat(supabase-client): add SMS preference, phone and verification wrappers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: `sms-verify` Edge Function

**Files:**
- Create: `supabase/functions/sms-verify/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: `normalizePhPhoneNumber` (Task 1), `createSmsProvider` (Task 3), `generateVerificationCode`, `hashVerificationCode`, `checkSendAllowed`, `evaluateConfirm`, `CODE_TTL_MS`, `PendingVerification` (Task 4); tables and the `increment_phone_verification_attempts` RPC (Task 5).
- Produces: `POST /functions/v1/sms-verify`, JWT required.
  - `{ action: 'request', phone }` returns `200 { status: 'sent' }`, or `{ error }` with 400 (bad number or body), 401, 403 (SMS globally off), 429 (`retry_after` seconds), 502 (gateway failure), 503 (provider not configured).
  - `{ action: 'confirm', code }` returns `200 { status: 'verified', phone_e164 }`, or `{ error }` with 400, 401, 429.

There is no Deno test setup in this repo, so this function is verified manually in Task 10; its decision logic is already covered by the Task 4 tests.

- [ ] **Step 1: Pin JWT verification in the config**

Append to `supabase/config.toml`:

```toml

# sms-verify identifies the caller from the JWT, so the gateway must verify it.
[functions.sms-verify]
verify_jwt = true
```

- [ ] **Step 2: Write the function**

Create `supabase/functions/sms-verify/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizePhPhoneNumber } from '../../../packages/core/src/phoneNumber.ts';
import { createSmsProvider } from '../../../packages/core/src/smsProvider.ts';
import {
  CODE_TTL_MS,
  checkSendAllowed,
  evaluateConfirm,
  generateVerificationCode,
  hashVerificationCode,
  type PendingVerification,
} from '../../../packages/core/src/phoneVerification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AdminClient = ReturnType<typeof createClient>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toPending(row: any): PendingVerification {
  return {
    phoneE164: row.phone_e164,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    lastSentAt: row.last_sent_at,
    sendsInWindow: row.sends_in_window,
    windowStartedAt: row.window_started_at,
  };
}

async function deletePending(admin: AdminClient, userId: string) {
  await admin.from('phone_verifications').delete().eq('user_id', userId);
}

async function handleRequest(admin: AdminClient, userId: string, phoneInput: unknown): Promise<Response> {
  const phone = typeof phoneInput === 'string' ? normalizePhPhoneNumber(phoneInput) : null;
  if (!phone) {
    return json(
      {
        error:
          'Enter a Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX). International numbers are not supported.',
      },
      400
    );
  }

  const { data: settings } = await admin
    .from('app_settings')
    .select('sms_notifications_enabled')
    .limit(1)
    .maybeSingle();
  if (!settings?.sms_notifications_enabled) {
    return json({ error: 'SMS notifications are not enabled.' }, 403);
  }

  let provider;
  try {
    provider = createSmsProvider(
      { SMS_PROVIDER: Deno.env.get('SMS_PROVIDER'), TEXTBEE_API_KEY: Deno.env.get('TEXTBEE_API_KEY') },
      fetch
    );
  } catch (err) {
    console.error('sms-verify: provider not configured', err);
    return json({ error: 'SMS is not configured.' }, 503);
  }

  const { data: existing } = await admin.from('phone_verifications').select('*').eq('user_id', userId).maybeSingle();
  const now = new Date();
  const decision = checkSendAllowed(existing ? toPending(existing) : null, now);
  if (!decision.allowed) {
    return json(
      {
        error: `Please wait ${decision.retryAfterSeconds} seconds before requesting another code.`,
        retry_after: decision.retryAfterSeconds,
      },
      429
    );
  }

  const code = generateVerificationCode(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const codeHash = await hashVerificationCode(sha256Hex, userId, phone, code);

  const { error: upsertError } = await admin.from('phone_verifications').upsert({
    user_id: userId,
    phone_e164: phone,
    code_hash: codeHash,
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    last_sent_at: now.toISOString(),
    sends_in_window: decision.sendsInWindow,
    window_started_at: decision.windowStartedAt,
  });
  if (upsertError) {
    console.error('sms-verify: could not store code', upsertError.message);
    return json({ error: 'Could not start verification. Try again later.' }, 500);
  }

  const sent = await provider.send({ to: phone, text: `Pantry Manager code: ${code}. Valid for 10 minutes.` });
  if (!sent.ok) {
    await deletePending(admin, userId);
    console.error('sms-verify: send failed', sent.error);
    return json({ error: 'Could not send the code. Try again later.' }, 502);
  }

  return json({ status: 'sent' });
}

async function handleConfirm(admin: AdminClient, userId: string, codeInput: unknown): Promise<Response> {
  if (typeof codeInput !== 'string' || !/^\d{6}$/.test(codeInput)) {
    return json({ error: 'Enter the 6-digit code.' }, 400);
  }

  // Increment first (atomically, in SQL) so concurrent guesses can't share an attempt.
  const { data: rows, error: incrementError } = await admin.rpc('increment_phone_verification_attempts', {
    p_user_id: userId,
  });
  if (incrementError) {
    console.error('sms-verify: increment failed', incrementError.message);
    return json({ error: 'Could not check the code. Try again.' }, 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;

  const submittedHash = row ? await hashVerificationCode(sha256Hex, userId, row.phone_e164, codeInput) : '';
  const decision = evaluateConfirm(row ? toPending(row) : null, new Date(), submittedHash);

  switch (decision.kind) {
    case 'no_pending':
      return json({ error: 'No verification in progress. Request a new code.' }, 400);
    case 'expired':
      await deletePending(admin, userId);
      return json({ error: 'That code has expired. Request a new one.' }, 400);
    case 'too_many_attempts':
      await deletePending(admin, userId);
      return json({ error: 'Too many wrong attempts. Request a new code.' }, 429);
    case 'wrong_code':
      return json({ error: `That code is not right. ${decision.attemptsLeft} attempts left.` }, 400);
    case 'ok': {
      const { error: saveError } = await admin.from('user_phone_numbers').upsert({
        user_id: userId,
        phone_e164: row.phone_e164,
        verified_at: new Date().toISOString(),
      });
      if (saveError) {
        console.error('sms-verify: could not save number', saveError.message);
        return json({ error: 'Could not save your number. Try again.' }, 500);
      }
      await deletePending(admin, userId);
      return json({ status: 'verified', phone_e164: row.phone_e164 });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(authHeader.slice('Bearer '.length));
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: { action?: string; phone?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'request') return handleRequest(admin, userId, body.phone);
  if (body.action === 'confirm') return handleConfirm(admin, userId, body.code);
  return json({ error: 'Unknown action' }, 400);
});
```

- [ ] **Step 3: Type-check what can be checked locally**

Deno is not installed here, so there is no full check. Run `supabase functions serve sms-verify --no-verify-jwt` only if the user has Docker set up; otherwise skip. At minimum confirm the import paths resolve:

Run: `ls packages/core/src/phoneNumber.ts packages/core/src/smsProvider.ts packages/core/src/phoneVerification.ts`
Expected: all three files listed. Also confirm none of the three has a relative `import` or `from './…'` line: `grep -nE "from '\./|from \"\./" packages/core/src/phoneNumber.ts packages/core/src/smsProvider.ts packages/core/src/phoneVerification.ts packages/core/src/digestSms.ts` must print nothing.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/sms-verify/index.ts supabase/config.toml
git commit -m "feat(functions): add sms-verify Edge Function for phone number verification

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 8: SMS in the daily digest function

**Files:**
- Modify (full replacement): `supabase/functions/compute-and-send-reminders/index.ts`

**Interfaces:**
- Consumes: `buildDigestSms` (Task 2), `createSmsProvider` (Task 3), the new columns and `notification_deliveries` table (Task 5).
- Produces: the same endpoint, same auth, same email behavior; the response body gains `sms: { status, results? }` where `status` is one of `sent`, `send_failed`, `nothing_to_send`, `no_opted_in_members`, `sms_not_configured`, `disabled_globally`, `household_disabled`, or `error`. The top-level `status` and HTTP code still describe the email block only (`disabled_globally`, `already_sent_today`, `no_eligible_items`, `no_opted_in_members`, `sent`, `send_failed` with 502, `error` with 500).

Behavior changes versus today, and nothing else:
1. The global-disable early return now happens only when both channels are globally off.
2. `already_sent_today` skips only the email block; SMS still runs.
3. The reminder list is loaded before the email-specific checks, because SMS needs it too.

- [ ] **Step 1: Replace the function**

Overwrite `supabase/functions/compute-and-send-reminders/index.ts` with:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildDigestEmail,
  shouldMarkDigestSent,
  type DigestItem,
} from '../../../packages/core/src/notificationDigest.ts';
import { buildDigestSms } from '../../../packages/core/src/digestSms.ts';
import { createSmsProvider } from '../../../packages/core/src/smsProvider.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM = Deno.env.get('RESEND_FROM_ADDRESS')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AdminClient = ReturnType<typeof createClient>;

interface ChannelOutcome {
  status: string;
  results?: unknown[];
  error?: string;
}

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

function manilaDateString(date: Date): string {
  // en-CA gives YYYY-MM-DD directly, avoiding a second parse/format step.
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendEmailDigest(
  admin: AdminClient,
  householdId: string,
  household: { name: string; notify_email_intro: string | null; last_digest_sent_date: string | null },
  todayManila: string,
  digestItems: DigestItem[]
): Promise<ChannelOutcome> {
  if (household.last_digest_sent_date === todayManila) {
    return { status: 'already_sent_today' };
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true);
  if (membersError) {
    return { status: 'error', error: `Failed to load members: ${membersError.message}` };
  }
  if (!members || members.length === 0) {
    return { status: 'no_opted_in_members' };
  }

  const { subject, body } = buildDigestEmail({
    householdName: household.name,
    introText: household.notify_email_intro,
    items: digestItems,
  });

  const results: { userId: string; ok: boolean; error?: string }[] = [];
  for (const member of members) {
    const { data: userResult, error: userLookupError } = await admin.auth.admin.getUserById(member.user_id);
    const email = userResult?.user?.email;
    if (userLookupError || !email) {
      results.push({ userId: member.user_id, ok: false, error: userLookupError?.message ?? 'no email on file' });
      continue;
    }

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, text: body }),
      });
      if (!resendResponse.ok) {
        const detail = await resendResponse.text();
        results.push({ userId: member.user_id, ok: false, error: `Resend ${resendResponse.status}: ${detail}` });
        continue;
      }
      results.push({ userId: member.user_id, ok: true });
    } catch (err) {
      results.push({ userId: member.user_id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Set only once at least one email actually went out — a crash before this
  // point (e.g. the reminders/members queries failing) or a batch where every
  // send failed leaves last_digest_sent_date untouched so a later retry the
  // same day can still send.
  if (!shouldMarkDigestSent(results)) {
    return { status: 'send_failed', results };
  }

  await admin.from('households').update({ last_digest_sent_date: todayManila }).eq('id', householdId);
  return { status: 'sent', results };
}

async function sendSmsDigest(
  admin: AdminClient,
  householdId: string,
  householdName: string,
  todayManila: string,
  digestItems: DigestItem[]
): Promise<ChannelOutcome> {
  let provider;
  try {
    provider = createSmsProvider(
      { SMS_PROVIDER: Deno.env.get('SMS_PROVIDER'), TEXTBEE_API_KEY: Deno.env.get('TEXTBEE_API_KEY') },
      fetch
    );
  } catch (err) {
    console.error('compute-and-send-reminders: SMS provider not configured', err);
    return { status: 'sms_not_configured' };
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true)
    .eq('sms_enabled', true);
  if (membersError) {
    return { status: 'error', error: `Failed to load SMS members: ${membersError.message}` };
  }
  if (!members || members.length === 0) {
    return { status: 'no_opted_in_members' };
  }

  const userIds = members.map((member: { user_id: string }) => member.user_id);
  const [{ data: phones, error: phonesError }, { data: delivered, error: deliveredError }] = await Promise.all([
    admin.from('user_phone_numbers').select('user_id, phone_e164').in('user_id', userIds),
    admin
      .from('notification_deliveries')
      .select('user_id')
      .eq('household_id', householdId)
      .eq('channel', 'sms')
      .eq('digest_date', todayManila)
      .eq('status', 'sent')
      .in('user_id', userIds),
  ]);
  if (phonesError || deliveredError) {
    return { status: 'error', error: `Failed to load SMS recipients: ${(phonesError ?? deliveredError)!.message}` };
  }

  const phoneByUser = new Map<string, string>(
    (phones ?? []).map((row: { user_id: string; phone_e164: string }) => [row.user_id, row.phone_e164])
  );
  const alreadySent = new Set<string>((delivered ?? []).map((row: { user_id: string }) => row.user_id));
  const text = buildDigestSms({ householdName, items: digestItems });

  const results: { userId: string; status: string; error?: string }[] = [];
  for (const userId of userIds) {
    if (alreadySent.has(userId)) {
      results.push({ userId, status: 'already_sent' });
      continue;
    }
    const phone = phoneByUser.get(userId);
    if (!phone) {
      results.push({ userId, status: 'no_verified_number' });
      continue;
    }

    const sent = await provider.send({ to: phone, text });
    const { error: logError } = await admin.from('notification_deliveries').upsert(
      {
        household_id: householdId,
        user_id: userId,
        channel: 'sms',
        digest_date: todayManila,
        status: sent.ok ? 'sent' : 'failed',
        provider_message_id: sent.ok ? sent.id ?? null : null,
        error: sent.ok ? null : sent.error,
      },
      { onConflict: 'household_id,user_id,channel,digest_date' }
    );
    if (logError) console.error('compute-and-send-reminders: could not log SMS delivery', logError.message);
    results.push(sent.ok ? { userId, status: 'sent' } : { userId, status: 'failed', error: sent.error });
  }

  if (results.some((result) => result.status === 'sent')) return { status: 'sent', results };
  if (results.some((result) => result.status === 'failed')) return { status: 'send_failed', results };
  return { status: 'nothing_to_send', results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // The gateway verifies the JWT signature (verify_jwt is pinned to true in
  // supabase/config.toml), so the role claim is trustworthy here. We used to
  // also require the token to equal SUPABASE_SERVICE_ROLE_KEY, but that env
  // value can drift from the key the cron job sends after an API-key refresh,
  // which silently 401'd every scheduled run.
  const authHeader = req.headers.get('Authorization');
  const callerRole = decodeJwtRole(authHeader);
  if (callerRole !== 'service_role' && callerRole !== 'authenticated') {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  let householdId: string | undefined;
  try {
    const payload = await req.json();
    householdId = payload.household_id;
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: corsHeaders });
  }
  if (!householdId) {
    return new Response('household_id is required', { status: 400, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (callerRole === 'authenticated') {
    const token = authHeader!.slice('Bearer '.length);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const { data: membership } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', householdId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new Response('Forbidden: only household owners/admins can trigger reminders', { status: 403, headers: corsHeaders });
    }
  }

  const { data: appSettings } = await admin
    .from('app_settings')
    .select('email_notifications_enabled, sms_notifications_enabled')
    .limit(1)
    .maybeSingle();
  const emailGloballyOn = !appSettings || appSettings.email_notifications_enabled !== false;
  const smsGloballyOn = appSettings?.sms_notifications_enabled === true;
  if (!emailGloballyOn && !smsGloballyOn) {
    return jsonResponse({ status: 'disabled_globally' });
  }

  const { error: refreshError } = await admin.rpc('refresh_household_reminders', {
    p_household_id: householdId,
  });
  if (refreshError) {
    return new Response(`Failed to refresh reminders: ${refreshError.message}`, { status: 500, headers: corsHeaders });
  }

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('name, notify_email_intro, last_digest_sent_date, sms_enabled')
    .eq('id', householdId)
    .single();
  if (householdError || !household) {
    return new Response(`Failed to load household: ${householdError?.message ?? 'not found'}`, { status: 500, headers: corsHeaders });
  }

  const todayManila = manilaDateString(new Date());

  const { data: reminders, error: remindersError } = await admin
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);
  if (remindersError) {
    return new Response(`Failed to load reminders: ${remindersError.message}`, { status: 500, headers: corsHeaders });
  }

  if (!reminders || reminders.length === 0) {
    return jsonResponse({ status: 'no_eligible_items' });
  }

  const todayMs = Date.parse(`${todayManila}T00:00:00Z`);
  const digestItems: DigestItem[] = reminders
    .filter((row: any) => row.pantry_items)
    .map((row: any) => {
      const expiryMs = Date.parse(`${row.pantry_items.expiration_date}T00:00:00Z`);
      const daysUntilExpiry = Math.round((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
      return { name: row.pantry_items.name as string, daysUntilExpiry };
    });

  // The two channels are independent: a failure in one never blocks or
  // un-marks the other, and each has its own same-day dedupe.
  const emailOutcome: ChannelOutcome = emailGloballyOn
    ? await sendEmailDigest(admin, householdId, household, todayManila, digestItems)
    : { status: 'disabled_globally' };

  let smsOutcome: ChannelOutcome;
  if (!smsGloballyOn) {
    smsOutcome = { status: 'disabled_globally' };
  } else if (!household.sms_enabled) {
    smsOutcome = { status: 'household_disabled' };
  } else {
    smsOutcome = await sendSmsDigest(admin, householdId, household.name, todayManila, digestItems);
  }

  const body = { ...emailOutcome, sms: smsOutcome };
  if (emailOutcome.status === 'send_failed') return jsonResponse(body, 502);
  if (emailOutcome.status === 'error') return jsonResponse(body, 500);
  return jsonResponse(body);
});
```

- [ ] **Step 2: Confirm the unchanged email behavior by diffing against the old version**

Run: `git diff supabase/functions/compute-and-send-reminders/index.ts | head -200`
Expected: the email request, the Resend call, the `shouldMarkDigestSent` check and the `last_digest_sent_date` update appear as moved, not changed. If the diff shows any edit to those lines other than being relocated into `sendEmailDigest`, fix it.

- [ ] **Step 3: Check the imports resolve and the shared modules stay self-contained**

Run: `ls packages/core/src/digestSms.ts packages/core/src/smsProvider.ts packages/core/src/notificationDigest.ts && grep -nE "from '\./|from \"\./" packages/core/src/digestSms.ts packages/core/src/smsProvider.ts packages/core/src/notificationDigest.ts`
Expected: the three files are listed and the grep prints nothing. Also run the core and client suites once more: `cd packages/core && npx jest && cd ../supabase-client && npx jest`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/compute-and-send-reminders/index.ts
git commit -m "feat(functions): send the daily digest by SMS alongside email

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: Web UI

**Files:**
- Create: `apps/web/src/components/pantry/SmsPrefsSection.tsx`
- Modify: `apps/web/src/components/pantry/NotificationPrefsModal.tsx`
- Modify: `apps/web/src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: the Task 6 wrappers, `normalizePhPhoneNumber` (Task 1), and the existing `useAuth`, `supabase`, and `color`/`inputStyle`/`buttonStyle`/`labelStyle` helpers.
- Produces: `SmsPrefsSection({ householdId, isAdmin })` rendered inside the preferences modal; an "SMS notifications" toggle on the admin settings page.

This task adds no new routes or Next.js APIs, only client components, so the Next.js docs warning in `apps/web/AGENTS.md` does not apply beyond following the existing component patterns exactly.

- [ ] **Step 1: Create the SMS section component**

Create `apps/web/src/components/pantry/SmsPrefsSection.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  confirmPhoneVerification,
  getHouseholdSmsEnabled,
  getMemberSmsEnabled,
  getMyPhoneNumber,
  removeMyPhoneNumber,
  requestPhoneVerification,
  setHouseholdSmsEnabled,
  setMemberSmsEnabled,
} from '@pantry/supabase-client';
import { normalizePhPhoneNumber } from '@pantry/core';
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { color, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

function maskPhone(phoneE164: string): string {
  return `${phoneE164.slice(0, 3)}••••••${phoneE164.slice(-4)}`;
}

export function SmsPrefsSection({ householdId, isAdmin }: { householdId: string; isAdmin: boolean }) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [householdSms, setHouseholdSms] = useState(false);
  const [memberSms, setMemberSms] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<'enter' | 'code'>('enter');
  const [phoneInput, setPhoneInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      getHouseholdSmsEnabled(supabase, householdId),
      getMemberSmsEnabled(supabase, householdId, session.user.id),
      getMyPhoneNumber(supabase, session.user.id),
    ])
      .then(([householdEnabled, memberEnabled, number]) => {
        setHouseholdSms(householdEnabled);
        setMemberSms(memberEnabled);
        setPhone(number?.phoneE164 ?? null);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load SMS settings'))
      .finally(() => setLoading(false));
  }, [householdId, session]);

  function resetEditing() {
    setEditing(false);
    setStage('enter');
    setPhoneInput('');
    setCodeInput('');
  }

  async function handleHouseholdToggle(next: boolean) {
    setHouseholdSms(next);
    setError(null);
    try {
      await setHouseholdSmsEnabled(supabase, householdId, next);
    } catch (err) {
      setHouseholdSms(!next);
      setError(err instanceof Error ? err.message : 'Failed to update the household SMS setting');
    }
  }

  async function handleMemberToggle(next: boolean) {
    if (!session) return;
    setMemberSms(next);
    setError(null);
    try {
      await setMemberSmsEnabled(supabase, householdId, session.user.id, next);
    } catch (err) {
      setMemberSms(!next);
      setError(err instanceof Error ? err.message : 'Failed to update your SMS setting');
    }
  }

  async function handleSendCode() {
    const normalized = normalizePhPhoneNumber(phoneInput);
    if (!normalized) {
      setError('Enter a Philippine mobile number, like 0917 123 4567. International numbers are not supported.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestPhoneVerification(supabase, normalized);
      setPhoneInput(normalized);
      setStage('code');
      setNotice(`We texted a 6-digit code to ${normalized}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await confirmPhoneVerification(supabase, codeInput.trim());
      setPhone(result.phoneE164);
      // They just proved the number to get texts, so turn the digest on for them.
      await setMemberSmsEnabled(supabase, householdId, session.user.id, true);
      setMemberSms(true);
      resetEditing();
      setNotice('Number verified. You will get the daily digest by SMS.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify the code');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await removeMyPhoneNumber(supabase, session.user.id);
      await setMemberSmsEnabled(supabase, householdId, session.user.id, false);
      setPhone(null);
      setMemberSms(false);
      resetEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove your number');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (loadError) {
    return (
      <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>
        Couldn&apos;t load SMS settings: {loadError}
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10, borderTop: `1px solid ${color.border}`, paddingTop: 14 }}>
      <strong style={{ fontSize: 13 }}>Text message (SMS) reminders</strong>

      {isAdmin && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={householdSms} onChange={(e) => handleHouseholdToggle(e.target.checked)} />
          Allow SMS reminders for this household
        </label>
      )}

      {!householdSms && !isAdmin && (
        <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>
          SMS reminders are not turned on for this household. Ask an owner or admin to enable them.
        </p>
      )}

      {householdSms && (
        <>
          {phone && !editing && (
            <>
              <p style={{ fontSize: 13, margin: 0 }}>
                Verified number: <strong>{maskPhone(phone)}</strong>
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={memberSms} onChange={(e) => handleMemberToggle(e.target.checked)} />
                Text me the daily digest
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setEditing(true)} style={buttonStyle('ghost')}>
                  Change number
                </button>
                <button type="button" onClick={handleRemove} disabled={busy} style={buttonStyle('ghost')}>
                  Remove
                </button>
              </div>
            </>
          )}

          {(!phone || editing) && stage === 'enter' && (
            <>
              <label style={labelStyle}>
                Philippine mobile number
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="0917 123 4567"
                  style={inputStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleSendCode} disabled={busy || !phoneInput.trim()} style={buttonStyle('secondary')}>
                  {busy ? 'Sending…' : 'Send code'}
                </button>
                {editing && (
                  <button type="button" onClick={resetEditing} style={buttonStyle('ghost')}>
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {(!phone || editing) && stage === 'code' && (
            <>
              <label style={labelStyle}>
                6-digit code
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  style={inputStyle}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handleVerify} disabled={busy || codeInput.length !== 6} style={buttonStyle('primary')}>
                  {busy ? 'Checking…' : 'Verify'}
                </button>
                <button type="button" onClick={() => setStage('enter')} style={buttonStyle('ghost')}>
                  Use a different number
                </button>
              </div>
            </>
          )}
        </>
      )}

      {notice && <p style={{ color: color.mutedForeground, fontSize: 12, margin: 0 }}>{notice}</p>}
      {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
```

Before moving on, confirm `color.border` exists in `apps/web/src/lib/theme.ts` (`grep -n "border" apps/web/src/lib/theme.ts`). If the token is named differently, use the existing border token instead of inventing one.

- [ ] **Step 2: Render it in the preferences modal**

In `apps/web/src/components/pantry/NotificationPrefsModal.tsx`:

1. Add the import after the `emitNotificationsChanged` import:

```tsx
import { SmsPrefsSection } from './SmsPrefsSection';
```

2. Directly after the closing `</label>` of the "Notify me about expiring items (in-app and email)" checkbox (the one ending at `Notify me about expiring items (in-app and email)\n            </label>`), add:

```tsx
            <SmsPrefsSection householdId={householdId} isAdmin={isAdmin} />
```

- [ ] **Step 3: Add the global SMS toggle to the admin settings page**

In `apps/web/src/app/admin/settings/page.tsx`:

1. Change the import line to:

```tsx
import {
  checkIsPlatformAdmin,
  getAppSettings,
  setEmailNotificationsEnabled,
  setSmsNotificationsEnabled,
} from '@pantry/supabase-client';
```

2. After the `emailNotificationsEnabled` state line add:

```tsx
  const [smsNotificationsEnabled, setSmsNotificationsEnabledState] = useState(false);
```

3. In the effect, replace:

```tsx
            .then((settings) => setEmailNotificationsEnabledState(settings.emailNotificationsEnabled))
```

with:

```tsx
            .then((settings) => {
              setEmailNotificationsEnabledState(settings.emailNotificationsEnabled);
              setSmsNotificationsEnabledState(settings.smsNotificationsEnabled);
            })
```

4. After the `handleToggle` function add:

```tsx
  async function handleSmsToggle() {
    if (!session) return;
    const next = !smsNotificationsEnabled;
    setSaving(true);
    setSaveError(null);
    try {
      await setSmsNotificationsEnabled(supabase, next, session.user.id);
      setSmsNotificationsEnabledState(next);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update setting');
    } finally {
      setSaving(false);
    }
  }
```

5. Replace the line `{saveError && <AlertBanner tone="destructive">{saveError}</AlertBanner>}\n      </section>` (the end of the existing email section) with the version below, which keeps the error banner at the end of a second section:

```tsx
      </section>

      <section style={{ ...cardStyle, padding: 20, display: 'grid', gap: 12 }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={smsNotificationsEnabled}
            disabled={saving}
            onChange={handleSmsToggle}
            style={{ marginTop: 3 }}
          />
          <span>
            <span style={{ display: 'block', fontWeight: 600, color: color.foreground }}>SMS notifications</span>
            <span style={{ display: 'block', fontSize: 13, color: color.mutedForeground, fontWeight: 400, marginTop: 2 }}>
              When off, no SMS goes out and phone numbers cannot be verified, regardless of each household&apos;s or
              member&apos;s SMS setting. Needs the gateway phone online and the TEXTBEE_API_KEY secret set.
            </span>
          </span>
        </label>
        {saveError && <AlertBanner tone="destructive">{saveError}</AlertBanner>}
      </section>
```

Make sure the first section no longer contains its own `saveError` banner after this edit (the single banner now lives in the second section and reports errors from both toggles).

- [ ] **Step 4: Type-check the web app**

Run: `cd /Users/ronnel/Documents/Applications/PantryManager && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors. Also run the whole workspace once: `npm run typecheck && npm test`. Expected: PASS.

- [ ] **Step 5: Look at it running (use the `run-web` skill)**

Start the dev server with the `run-web` skill and check, signed in as the repo owner's account:
- Notification preferences modal shows the new "Text message (SMS) reminders" block.
- With the household switch off, an owner sees "Allow SMS reminders for this household" and a plain member sees the "not turned on" note.
- With it on, the phone field appears. Typing `+1 202 555 0123` and pressing Send code shows the "Philippine mobile number" error with no network call.
- The admin settings page shows the "SMS notifications" toggle.
Do not press Send code with a real Philippine number until Task 10 has the secrets and the gateway phone in place.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/pantry/SmsPrefsSection.tsx apps/web/src/components/pantry/NotificationPrefsModal.tsx apps/web/src/app/admin/settings/page.tsx
git commit -m "feat(web): add SMS number verification and SMS toggles to settings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: Deploy and verify end to end (needs the user)

Everything here touches the live Supabase project or needs the gateway phone. Ask the user before each numbered group, and run nothing until they agree. Use only the repo owner's own number for real sends.

**Files:** none (configuration and manual verification). Record the outcome in the final message, not in a new file.

- [ ] **Step 1: The user sets up the gateway phone**

The user does this on the Android phone: install the TextBee app, sign in, register the device, disable battery optimization for it, keep it charged and online, and confirm the SIM has a text promo. They create an API key in the TextBee dashboard. Check the free plan's monthly message cap on TextBee's pricing page and note it.

- [ ] **Step 2: Apply the migration FIRST** (Task 5, Step 4 SQL checks included). Never deploy the functions before this: the new `compute-and-send-reminders` selects `households.sms_enabled` and `app_settings.sms_notifications_enabled`, and without the migration the live email digest would return 500. The migration has never been run anywhere, so prefer a Supabase branch or scratch database first.

Run: `supabase db push` after the user confirms the linked project is the intended one. Then run the constraint checks from Task 5 Step 4.
Expected: migration applied; the international-number insert is rejected by the CHECK constraint.

- [ ] **Step 3: Set secrets and deploy both functions**

```bash
supabase secrets set TEXTBEE_API_KEY=<the key the user created> SMS_PROVIDER=textbee
supabase functions deploy sms-verify
supabase functions deploy compute-and-send-reminders
```

Expected: both deploy; `supabase functions list` shows them active. The secret value comes from the user, never from this repo.

- [ ] **Step 4: Turn SMS on and verify the verification flow with the owner's own number**

1. Admin settings page: turn on "SMS notifications".
2. In a test household's preferences modal: turn on "Allow SMS reminders for this household".
3. Enter the owner's own number in a messy format (`0917 123 4567` style), press Send code. Expected: an SMS arrives on that phone within about a minute with a 6-digit code.
4. Press Send code again immediately. Expected: "Please wait N seconds…".
5. Enter a wrong code. Expected: "That code is not right. 4 attempts left."
6. Enter the right code. Expected: "Number verified", the masked number shows, and "Text me the daily digest" is checked.
7. In the SQL editor confirm one row in `user_phone_numbers` for that user and none in `phone_verifications`.
8. Throttle abuse checks (final-review finding C1; these are the only verification of that fix, since the function cannot be unit-tested). With a signed-in user's token and the owner's own number:
   - Fire 10 `request` calls in parallel (`for i in 1 2 3 4 5 6 7 8 9 10; do curl ... & done; wait`). Expected: exactly one `200`, the rest `429`, and exactly one SMS arrives.
   - Burn a code (5 wrong `confirm` calls), then immediately `request` again. Expected: `429` "Please wait…" until the 60 second cooldown passes, and after 5 sends in an hour, `429` until the window reopens (in `phone_verifications`, `sends_in_window` keeps counting and the row is never deleted).
9. Try an international number through the form. Expected: rejected before any network call. Then call the function directly with one to confirm the server refuses it too:

```bash
curl -s -X POST "https://nrjeqeddlssrxaskovrs.supabase.co/functions/v1/sms-verify" \
  -H "Authorization: Bearer <a signed-in user's access token>" \
  -H "Content-Type: application/json" \
  -d '{"action":"request","phone":"+12025550123"}'
```

Expected: HTTP 400 with the "Philippine mobile number" message.

On the first real send also confirm TextBee's route and response: if the call is rejected, check the TextBee docs for the device-id form of the send route, and note which key holds the message id (the code looks for `_id`/`id`, so `provider_message_id` may stay null).

- [ ] **Step 5: Verify the digest**

1. Make sure the test household has an item inside its expiry window.
2. Press "Send reminders now" in the modal. Expected: the response includes `sms: { status: 'sent' }` and an SMS arrives with the digest text, at most 160 characters.
3. Press it again. Expected: top-level `already_sent_today` for email, `sms` `status: 'nothing_to_send'` with the user marked `already_sent` (no second text).
4. Failure and retry (Review Focus 2): switch the gateway phone to airplane mode, delete today's `notification_deliveries` row for the user, press the button. Expected: `sms.status` `send_failed`, a `failed` row with an error, email unaffected. Turn the phone back online and press again. Expected: `sent`, row updated.
5. Review Focus 4: turn the household switch off and press the button, expecting `household_disabled`. Turn it back on, remove the number in the modal, press the button, expecting `nothing_to_send` with `no_verified_number`. Turn the global SMS switch off, expecting `disabled_globally`, while email still sends on a day it has not gone out.
6. Review Focus 6: if the user is in two households with SMS on, confirm each household's digest produces its own text on the same day.

- [ ] **Step 6: Check the scheduled path**

After the next scheduled send time for the test household, run in the SQL editor: `select id, status_code, content from net._http_response order by created desc limit 5;` Expected: status 200 responses. The cron job reports success even when the function returns 401, so a non-200 here means the schedule is not actually working.

- [ ] **Step 7: Close out**

Report to the user: what was verified, anything that failed, TextBee's free-plan cap as found on their pricing page, and that Telegram remains on hold. Ask whether to remove the uncommitted `next.config.js` change from their working tree or leave it. Do not touch it.
