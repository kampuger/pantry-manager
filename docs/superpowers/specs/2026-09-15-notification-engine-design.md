# Notification Engine: Daily Expiry Reminders, Email Digest & On-Demand Trigger

Status: Approved for planning
Date: 2026-09-15

## Problem

Households have no way to be proactively told about expiring pantry items.
`households.notify_days_produce` / `notify_days_nonproduce` and a per-item
`pantry_items.notify_days_before_expiry` override already exist (added in
`20260914000001_pantry_produce_lifecycle_notifications.sql`), and the
`NotificationPrefsModal` on both platforms already lets users edit those
thresholds — but nothing consumes them. The modal's own copy says so:
"Push/browser notifications are coming in a future update — for now this
just saves your preference." `pg_cron` is enabled but no job is scheduled.
`packages/notifications/` has OS push-permission stubs that no screen calls.

This spec closes that gap: an in-app reminder list, a daily email digest,
and an on-demand trigger — all driven by one shared backend computation.

## Non-goals

- OS-level push notifications (APNs/FCM/web-push/VAPID). Deliberately out of
  scope: it needs push-token registration, ongoing token expiry handling,
  and can't be tested in a simulator. In-app + email cover the actual goal
  (make sure someone notices expiring food) without that infrastructure.
  `packages/notifications`' existing push stubs are not wired up by this
  work and remain unused.
- Per-household timezone support. All households are treated as a single
  timezone (Asia/Manila), matching the project's Philippine-household scope.
- Full email template editing (subject/body with placeholders). Only a short
  custom intro line is user-editable; the item list itself is fixed-format.
- Per-item snooze/dismiss. The only way to stop a reminder is to archive the
  item (mark it Consumed or Expired/Discard), which already exists.

## Current state (for reference)

- `households`: `notify_days_produce smallint default 2`,
  `notify_days_nonproduce smallint default 7`.
- `pantry_items`: `notify_days_before_expiry smallint` (nullable — null
  means "inherit the household default for this item's produce/non-produce
  type"), `is_produce boolean`, `expiration_date date`,
  `is_archived boolean`.
- `archive_pantry_item(item_id, event_type, quantity, triggered_by)`
  (`20260915000001_archive_pantry_item_function.sql`): atomically sets
  `is_archived = true` and writes an `inventory_movement_logs` row, gated by
  `is_household_member()`.
- `household_members`: `household_id, user_id, role (OWNER/ADMIN/MEMBER)`.
- `pg_cron` extension is enabled (`20260913000001_initial_schema.sql`); no
  job is scheduled yet.
- `NotificationPrefsModal` (`apps/web/src/components/pantry/` and
  `apps/mobile/src/components/pantry/`) edits the two household thresholds
  today; restricted server-side to owners/admins (existing RLS + error
  message pattern).

## Data model changes

New migration:

```sql
create table pantry_item_reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  first_notified_at timestamptz not null default now(),
  last_notified_at timestamptz not null default now(),
  unique (pantry_item_id)
);

create index idx_pantry_item_reminders_household on pantry_item_reminders(household_id);

alter table households
  add column notify_email_send_time time not null default '08:00',
  add column notify_email_intro text,
  add column last_digest_sent_date date;

alter table household_members
  add column notifications_enabled boolean not null default true;
```

- `pantry_item_reminders`: one row per currently-eligible item. Its
  existence *is* the in-app notification — no separate read/unread state.
  Deleted (see below) the moment the item is archived.
- `households.notify_email_send_time`: local (Asia/Manila) time-of-day the
  daily digest fires, owner/admin editable.
- `households.notify_email_intro`: optional custom intro line prepended to
  the digest body; null renders no extra line.
- `households.last_digest_sent_date`: tracks whether today's digest has
  already gone out, so the on-demand trigger and the scheduled run never
  double-send on the same day.
- `household_members.notifications_enabled`: per-member, per-household.
  Off means: the in-app bell shows nothing for that member, and they're
  excluded from the email digest recipient list for that household. Other
  members are unaffected.

RLS: `pantry_item_reminders` gets a select policy scoped to
`is_household_member(household_id)`, matching the existing pattern for
`pantry_items`.

**`archive_pantry_item()` gets one added statement**, in the same
transaction: `delete from pantry_item_reminders where pantry_item_id =
p_item_id;`. This is what makes reminders stop the instant an item is
marked consumed/discarded.

Regenerate the generated `Database` type
(`packages/supabase-client/src/types.ts`) after the migration.

## Reminder eligibility

An active (`is_archived = false`) item with a non-null `expiration_date` is
eligible once:

```
expiration_date - current_date <= coalesce(
  pantry_items.notify_days_before_expiry,
  case when pantry_items.is_produce
    then households.notify_days_produce
    else households.notify_days_nonproduce
  end
)
```

Items with no `expiration_date` are never eligible.

## Backend computation

**`compute_and_send_reminders(p_household_id uuid)`** (Supabase Edge
Function, service-role) is the single shared entry point, called by both
the cron path and the on-demand path:

1. Upsert into `pantry_item_reminders`: for every eligible item in the
   household, insert a new row (`first_notified_at = last_notified_at =
   now()`) or update `last_notified_at = now()` on an existing one. This
   step always runs — it's what keeps the in-app bell fresh regardless of
   email settings.
2. Delete rows from `pantry_item_reminders` for items that are no longer
   eligible (e.g., threshold was raised, or the item's expiry changed) —
   keeps the table's contents authoritative rather than append-only.
3. If `households.last_digest_sent_date` is not today **and** there is at
   least one row in `pantry_item_reminders` for this household **and** at
   least one household member has `notifications_enabled = true`: build one
   digest (subject: `"<N> item(s) expiring soon in <Household Name>"`;
   body: the custom intro line if set, then the eligible items sorted
   soonest-first with name + days-until-expiry) and send it via Resend, one
   email per opted-in member (each gets their own message — no CC, so
   members never see each other's addresses). Set
   `last_digest_sent_date = current_date` immediately after attempting the
   sends, whether or not every individual send succeeded.
4. A failed Resend call for one member is logged and skipped — it never
   blocks sends to other members, other households in the same cron tick,
   or step 1/2's already-committed upsert.

**Scheduling**: `pg_cron` fires a small Postgres (plpgsql) wrapper function
every 15 minutes. The wrapper selects households where `current_time`
(Asia/Manila) falls within `[notify_email_send_time, notify_email_send_time
+ 15 minutes)`, and for each, calls the `compute_and_send_reminders` Edge
Function via the `pg_net` extension's `net.http_post`, with a secret bearer
token (stored as a database setting) in the request header — the Edge
Function rejects calls without that token, so it can't be invoked by an
unauthenticated client pretending to be the scheduler.

**On-demand trigger**: the client calls the same `compute_and_send_reminders`
Edge Function directly (via `supabase.functions.invoke`, authenticated with
the user's own session — no service-role/bearer-token path involved here).
The function first checks the caller's `household_members.role` is `OWNER`
or `ADMIN` for the target household before running; if not, it returns an
authorization error and does nothing. On success it's the same computation,
immediate instead of waiting for the next 15-minute window, and because it
also sets `last_digest_sent_date`, a later scheduled run that day won't
re-send.

**Resend integration**: API key stored as a Supabase Edge Function secret,
never exposed to client code. Free tier (100/day, 3000/month) comfortably
covers a household app's scale — noted here as the ceiling, not a concern
to design around further.

## UI components

**In-app bell** (web: header/nav icon; mobile: badge on the relevant tab):
badge count = number of rows in `pantry_item_reminders` for the household,
rendered only if the current member's `notifications_enabled` is true.
Clicking/tapping opens a panel listing item name + days-until-expiry,
reusing the existing `daysUntil` / `getExpiryBadgeStatus` helpers from
`@pantry/ui` for the same coloring already used on the Pantry screen.

**Settings** — extends the existing `NotificationPrefsModal` on both
platforms, replacing its "coming in a future update" note:
- Every member: a `notifications_enabled` toggle ("Notify me about
  expiring items").
- Owner/admin only (same gating as the existing threshold fields): the
  `notify_email_send_time` picker, the `notify_email_intro` text field, and
  a "Send reminders now" button.

**On-demand button**: owner/admin only, in the settings modal, calls the
on-demand RPC via `supabase.functions.invoke`, shows a brief success
("Reminders sent") or error status inline.

## Scope: both platforms

Shared logic (eligibility math already lives server-side; client-side
reminder-fetching and preference read/write calls) goes in
`packages/supabase-client` so both apps consume the same functions; only
rendering (bell icon/badge placement, modal layout) differs per platform.

## Testing

- Unit tests in `packages/supabase-client` for the new preference
  getters/setters and the reminders-fetch/on-demand-trigger RPC wrappers,
  matching the existing `household.test.ts` pattern (mocked Supabase
  client).
- Manual SQL-editor verification of the eligibility/upsert logic against
  seeded test data — this repo has no pgTAP setup, so this follows the same
  manual-verification pattern used for the `archive_pantry_item` migration.
- Manual verification of the Edge Function: invoke it directly against a
  test household and confirm the `pantry_item_reminders` upsert and a real
  Resend send both succeed (200 response), following the same
  direct-endpoint-curl verification pattern used to debug the password-reset
  flow.
- Live Playwright check (via `run-web`/`run-mobile`) that: the bell renders
  with the correct badge count for a seeded expiring item, the settings
  modal shows the new fields, the on-demand button is visible only for an
  owner/admin test account and hidden for a plain member, and clicking
  "Send reminders now" reflects a success state.
