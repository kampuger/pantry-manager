# SMS Notifications: Daily Expiry Digest via Android Phone Gateway (TextBee)

Status: Draft, awaiting review
Date: 2026-10-15

## Problem

The daily expiry digest (see `2026-09-15-notification-engine-design.md`) only
goes out by email. Household members are more likely to notice a text message.
This spec adds SMS as a second digest channel, opt-in per member, Philippines
numbers only.

A Telegram channel was discussed and is **on hold**. This design keeps the
channel logic provider-agnostic so a second channel can be added later, but
builds nothing for it now.

## Goals

- Opted-in members receive the same daily digest by SMS, in addition to email.
- Only Philippine mobile numbers (`+639XXXXXXXXX`) are accepted or messaged.
- Free to run for the pilot (a few household members) using an Android phone
  with a Philippine SIM as the gateway, via TextBee.
- Moving to another provider later (SMSGate, Semaphore, a paid gateway) is a
  one-file change.

## Non-goals

- Telegram, Viber, WhatsApp (on hold or rejected for now).
- Mobile app UI. Mobile work is paused; this is web only.
- Two-way SMS, replies, or inbound webhooks.
- Per-household timezones. Asia/Manila only, as in the existing engine.
- Owners entering phone numbers on behalf of other members.
- Delivery-status webhooks from the gateway. We log the gateway's immediate
  response only.

## Decisions

| Question | Decision |
|---|---|
| Who chooses channels? | Each member opts in. Owners/admins can also switch SMS on or off for the whole household. |
| What does the household switch do? | It makes SMS **available**. Members still opt in themselves. Turning it off stops SMS for everyone. |
| Phone number ownership | Verified with a 6-digit code before any digest is sent to it. |
| Provider | TextBee first, behind a small `SmsProvider` interface. |
| Number blocking | Enforced in the web form, the Edge Functions, and a database constraint. |

## Current state (relevant parts)

- `compute-and-send-reminders` (Edge Function) refreshes
  `pantry_item_reminders`, then returns early with `already_sent_today` when
  `households.last_digest_sent_date` is today, then sends email through Resend
  to members with `household_members.notifications_enabled = true`.
- `app_settings.email_notifications_enabled` is the global admin kill switch,
  but only for email.
- `packages/core/src/notificationDigest.ts` builds the email digest and holds
  `shouldMarkDigestSent`.
- `NotificationPrefsModal` (web) edits household thresholds and, per the
  engine spec, each member's `notifications_enabled`.

## Data model (one migration)

```sql
-- Verified phone number, one per user. Written only by the sms-verify Edge
-- Function (service role); users may read and delete their own row.
create table user_phone_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+639\d{9}$'),
  verified_at timestamptz not null default now()
);

-- Pending verification codes. No client access at all.
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

alter table household_members add column sms_enabled boolean not null default false;
alter table households        add column sms_enabled boolean not null default false;
alter table app_settings      add column sms_notifications_enabled boolean not null default false;

-- Per-household, per-channel, per-user, per-day dedupe and send log. The
-- household is part of the key so a member of two households gets both digests.
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
```

RLS:

- `user_phone_numbers`: select and delete own row. No insert or update policy.
- `phone_verifications`: RLS on, no policies (service role only).
- `notification_deliveries`: RLS on, select for household owners/admins; no
  client writes.
- `households.sms_enabled`: covered by the existing owner/admin update policy.
- `household_members.sms_enabled`: covered by the existing "members can update
  their own notification setting" policy and its escalation trigger.
- `app_settings.sms_notifications_enabled`: same policy as the existing email
  toggle.

The `channel` check allows only `'sms'` today; a later channel widens it in its
own migration.

The `Database` type in `packages/supabase-client/src/types.ts` is regenerated
after the migration.

## Phone number rules

`normalizePhPhoneNumber(input)` in `packages/core`:

- Strips spaces, dashes and parentheses.
- Accepts `09XXXXXXXXX`, `9XXXXXXXXX`, `639XXXXXXXXX`, `+639XXXXXXXXX`.
- Returns `+639XXXXXXXXX` or `null`. Anything else (any other country code,
  landlines, wrong length) returns `null`.

Enforced three times: the web form (normalizes and shows an error), both Edge
Functions (re-validate; never trust the client), and the table CHECK
constraints above.

## Verification flow (`sms-verify` Edge Function)

Authenticated users only (`verify_jwt = true`). Two actions:

**`request` `{ phone }`**
1. Normalize and reject non-PH numbers with a clear error.
2. Reject if `app_settings.sms_notifications_enabled` is false.
3. Rate limit per user: at most 1 send per 60 seconds and 5 per hour.
4. Generate a 6-digit code with a cryptographically secure source, store its
   SHA-256 hash keyed with the user id, expiry 10 minutes, `attempts = 0`.
5. Send `"Pantry Manager code: 123456. Valid for 10 minutes."` through the
   provider. If the provider fails, delete the pending row and return an error.

**`confirm` `{ code }`**
1. Load the pending row; reject if missing or expired.
2. Increment `attempts` first; reject and delete the pending row after 5 wrong
   attempts.
3. Compare hashes in constant time. On match, upsert `user_phone_numbers`
   (replacing any previous number) and delete the pending row.

Changing a number means a new verification. The old number stays active until
the new one is confirmed. Deleting a number turns off that member's SMS
automatically (the digest skips members without a verified number).

## Provider abstraction

`packages/core/src/smsProvider.ts` (pure, `fetch` injected, so jest can test it and
the Edge Functions import it by relative path, as they already do for
`notificationDigest.ts`):

```ts
interface SmsProvider {
  send(input: { to: string; text: string }):
    Promise<{ ok: true; id?: string } | { ok: false; error: string }>;
}
```

- The TextBee implementation uses `POST https://api.textbee.dev/api/v1/gateway/send-sms`,
  header `x-api-key: TEXTBEE_API_KEY`, body `{ recipients: [to], message: text }`.
  TextBee's documented rate limit is 60 requests a minute, so sends are
  sequential. Digest volume for a household is far below that.
- `createSmsProvider(env, fetch)` picks the provider from the `SMS_PROVIDER` secret (default
  `textbee`). Anything unknown fails loudly at startup.
- Secrets: `TEXTBEE_API_KEY`, `SMS_PROVIDER`.

## Digest sending changes

`compute-and-send-reminders` is restructured so SMS is independent of email:

1. Keep step 1 (reminder refresh) and the global/household gates as they are.
2. **Email block** keeps its current behavior, including the
   `last_digest_sent_date` check and update. It no longer returns early in a
   way that skips SMS: the "already sent today" outcome only skips the email
   block.
3. **SMS block** runs when `app_settings.sms_notifications_enabled` and
   `households.sms_enabled` are true and there is at least one eligible
   reminder:
   - Recipients: members with `sms_enabled` and `notifications_enabled` true
     who have a `user_phone_numbers` row, and no `notification_deliveries` row
     with `status = 'sent'` for today (Asia/Manila date).
   - For each recipient, send `buildDigestSms(...)`, then upsert a
     `notification_deliveries` row (`sent` or `failed` with the error).
   - A failure for one member never stops others and never affects email or
     `last_digest_sent_date`.
   - Because dedupe is per user and day, a manual "Send reminders now" retry
     later the same day re-attempts only the members whose SMS failed.
4. The response body adds an `sms` results array next to the existing email
   results. The HTTP status stays 200 when email succeeds; SMS failures are
   reported in the body and the delivery log.

`buildDigestSms({ householdName, items })` in `packages/core`:

- Plain GSM-7 text only (no emoji, no smart quotes) so a message stays one
  160-character segment where possible.
- Format: `Pantry (<household>): Milk today, Eggs in 2d, Rice in 5d +2 more. Open the app for details.`
- Items sorted soonest first; as many as fit, then `+N more`.
- Household name is truncated if needed.

## UI (web only)

- `NotificationPrefsModal`, every member: phone number field with a "Send code"
  button, a 6-digit code input, a verified state with "Change" and "Remove",
  and a "Text me the daily digest" toggle (disabled until a number is verified,
  and hidden when the household switch is off).
- `NotificationPrefsModal`, owner/admin only: "Allow SMS for this household"
  toggle.
- Global admin page: "Send SMS notifications" toggle next to the existing
  email toggle.
- Client wrappers for the new calls live in `packages/supabase-client` so
  mobile can reuse them later.

## Operations (the user's part)

- An Android phone with a Philippine SIM and a text promo.
- TextBee app installed and signed in, battery optimization disabled for it,
  phone kept charged and online.
- A TextBee API key stored as the `TEXTBEE_API_KEY` Supabase secret.
- Check the SIM promo's daily text limit. The free TextBee plan is documented
  as about 300 messages a month; a 10-member household with a daily digest
  uses roughly that many, so verification codes and retries can push past it.
  The pilot (a few members) stays well under.

## Failure handling

| Failure | Behavior |
|---|---|
| Gateway phone offline or TextBee down | Provider returns an error; delivery logged `failed`; email unaffected; a retry the same day re-attempts. |
| Monthly quota exceeded | Same as above; the error text is stored in `notification_deliveries.error`. |
| Invalid or non-PH number somehow stored | Skipped and logged; the CHECK constraint makes this unreachable for new rows. |
| Wrong or expired verification code | Clear error; five wrong attempts burn the code. |
| Provider secret missing | Function logs and returns an `sms_not_configured` entry; email still goes out. |

## Testing

- `packages/core` unit tests: `normalizePhPhoneNumber` (accepted forms,
  rejected countries, landlines, wrong lengths), `buildDigestSms` (ordering,
  `+N more`, length, GSM-7-only output).
- Provider test with a mocked `fetch`: success, HTTP error, network error,
  malformed response.
- `packages/supabase-client` wrapper tests with a mocked client, matching the
  existing pattern.
- Manual verification of both Edge Functions with direct requests against a
  test household, sending only to the owner's own number. Check
  `net._http_response` after the first cron run (the scheduler reports success
  even when the function returns 401).
- Manual SQL checks of the CHECK constraints and RLS (no pgTAP in this repo).
- Playwright check of the settings modal: verification flow, toggle states,
  owner/admin-only controls.

## Open items

- Confirm TextBee's free-plan monthly cap on their pricing page before the
  first rollout beyond the pilot.
- Revisit the provider once the household count grows past a few members
  (SMSGate, Semaphore, or self-hosted TextBee are the candidates).
