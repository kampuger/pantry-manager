# Pantry Screen: Editing, Produce-Aware Expiry, Lifecycle & Notification Preferences

Status: Approved for planning
Date: 2026-09-14

## Problem

The Pantry screen (both `apps/web` and `apps/mobile`) currently only supports
adding items and viewing them. There is no way to edit an item, mark it
consumed or expired, or configure expiry-notification timing. Expiry dates
are entered free-form with no produce-aware defaulting, and the pantry list
is a flat list with no per-location grouping.

This spec covers everything needed to close those gaps, on both platforms.
Actual notification *delivery* (push/browser notifications firing on a
schedule) is explicitly out of scope — see "Non-goals".

## Current state (for reference)

- Table `pantry_items` (`supabase/migrations/20260913000001_initial_schema.sql`):
  `id, household_id, category_id, grocery_trip_id, name, quantity, unit,
  storage_location (enum: FRIDGE/FREEZER/PANTRY/COUNTER/OTHER), purchase_date,
  expiration_date, purchase_price, replenishment_threshold,
  notify_on_low_stock, notify_days_before_expiry (smallint, default 3),
  is_archived, created_by, created_at, updated_at`.
- Table `inventory_movement_logs`: append-only audit log with `event_type`
  (PURCHASED/CONSUMED/EXPIRED/SPOILED_DISCARDED/MANUAL_ADJUST). Schema exists,
  nothing writes to it yet.
- `addPantryItem()` in `packages/supabase-client/src/pantry.ts` is the only
  write path today (insert only). RLS already grants members
  select/insert/update/delete on `pantry_items`
  (`supabase/migrations/20260913000002_rls_policies.sql`).
- Web add form has an expiry-date field; mobile's does not.
- `getExpiryBadgeStatus` (`@pantry/ui`) already buckets items into
  critical/warning/ok/unknown by days-until-expiry and drives both screens'
  list rendering today.
- `packages/notifications/` (Expo + web push wrappers) exists but is never
  imported by any screen — no delivery pipeline is wired up.
- No settings screen exists on either platform today.

## Non-goals

- Wiring actual notification **delivery** (cron job, push permission flow,
  background scheduling). This is a separate follow-up project once the
  preferences exist to drive it.
- Category-driven produce classification (`item_categories`) — produce is a
  per-item boolean, not inherited from category.
- Any change to the shopping-list or dashboard screens.

## Data model changes

New migration:

```sql
alter table pantry_items
  add column is_produce boolean not null default true;

alter table pantry_items
  alter column notify_days_before_expiry drop not null,
  alter column notify_days_before_expiry drop default;

alter table households
  add column notify_days_produce smallint not null default 2,
  add column notify_days_nonproduce smallint not null default 7;
```

- `is_produce`: defaults to `true` per requirement ("default per item should
  be a produce").
- `notify_days_before_expiry`: `null` means "inherit the household default
  for this item's produce/non-produce type"; a non-null value is a per-item
  override entered via the add/edit form's Advanced section.
- `households.notify_days_produce` / `notify_days_nonproduce`: household-wide
  defaults, editable via the new Notification Preferences screen.
- No changes to `inventory_movement_logs` or `is_archived` — both already fit
  the lifecycle design below.

Regenerate the generated `Database` type
(`packages/supabase-client/src/types.ts`) after the migration.

## Add/Edit item logic

New pure helper in `packages/core`:

```ts
function computeExpiryDate(input: {
  isProduce: boolean;
  purchaseDate: string; // ISO date
  manualDate?: string;  // required when isProduce is false
}): string // ISO date
```

- `isProduce: true` → `purchaseDate + 7 days`, ignoring any manual input.
- `isProduce: false` → returns `manualDate`; caller is responsible for
  requiring it in the form (validation error if missing).

**Add form** (both platforms, unified behavior — mobile currently lacks the
expiry field entirely and gains it here):

- Produce toggle, default **on**.
- When on: expiry date is computed and shown read-only.
- When off: a required date picker appears for manual expiry entry.
- Collapsed "Advanced" section: optional numeric override for
  notify-days-before-expiry (maps to `pantry_items.notify_days_before_expiry`;
  left blank ⇒ `null` ⇒ inherit household default).

**Edit form**: same field set and component, pre-filled from the existing
row, invoked from an "Edit" action on each pantry item. Flipping the produce
toggle recomputes expiry immediately (produce → `purchase_date + 7 days`;
non-produce → clears the field and requires the user to pick a new date
before saving).

New write path in `packages/supabase-client/src/pantry.ts`:

```ts
function updatePantryItem(itemId: string, changes: Partial<PantryItemInput>): Promise<void>
```

## Lifecycle: consumed / expired items

- Each active pantry item gets two actions: **Consumed** and
  **Expired/Discard**.
- Triggering either:
  1. `update pantry_items set is_archived = true where id = ...`
  2. Insert one row into `inventory_movement_logs` with
     `event_type = 'CONSUMED'` or `'SPOILED_DISCARDED'`, plus `item_id`,
     `household_id`, `quantity`, `created_by`, `occurred_at = now()`.
- Both writes happen in a single Supabase RPC/transaction-like call (a
  Postgres function `archive_pantry_item(item_id, event_type)`) so the
  archive and audit-log entry can't go out of sync — new migration adds this
  function.
- Archived items are excluded from the active list (existing
  `is_archived = false` filter already does this) and are **never hard
  deleted**. No history/browse-archive UI is being built now — the log
  exists for future use (e.g. a waste-insights view).
- Items whose `expiration_date` has passed but haven't been actioned show an
  "Expired" badge (extending the existing `getExpiryBadgeStatus` buckets)
  prompting the user to tap Consumed or Expired/Discard. Nothing
  auto-archives.

New shared helper:

```ts
function archivePantryItem(itemId: string, eventType: 'CONSUMED' | 'SPOILED_DISCARDED'): Promise<void>
```

## Notification preferences UI

- New entry point: a gear icon in the Pantry screen header (both platforms)
  opening a **Notification Preferences** screen (web: `/pantry/notifications`
  route or modal; mobile: a pushed screen from the same stack as Pantry).
- Two steppers/inputs:
  - "Remind me before expiry — Produce items: `[2]` days"
  - "Remind me before expiry — Non-produce items: `[7]` days"
- Saves directly to `households.notify_days_produce` /
  `notify_days_nonproduce`.
- Plain-language note under the form: notifications are configured here but
  delivery (the actual push/alert) is coming in a later update — this screen
  only sets the timing preference for when that ships.
- Per-item overrides are not configured here; they live in the add/edit
  item form's Advanced section (see above).

## Visual redesign (Pantry screen)

- Active items grouped by `storage_location` (FRIDGE/FREEZER/PANTRY/COUNTER/
  OTHER), each group rendered as a section with:
  - A header: location icon + name + summary (e.g. "🧊 Fridge · 5 items, 1
    expiring soon").
  - Empty locations are hidden rather than shown as empty sections.
- Each item row/card shows: name, quantity + unit, a produce indicator icon,
  the existing expiry badge, and the Edit / Consumed / Expired-Discard
  actions.
- Redesign extends the existing "Grocery-fresh" palette and Plus Jakarta Sans
  typography from the prior redesign commits — no new palette introduced.
- Implementation of this section is handed to the `ui-ux-pro-max:ui-styling`
  skill once this spec and the implementation plan are approved.

## Scope: both platforms

Every section above applies to both `apps/web/src/app/pantry/page.tsx` and
`apps/mobile/src/screens/PantryScreen.tsx`. Shared logic (expiry
computation, archive/update calls, type definitions) lives in
`packages/core` and `packages/supabase-client` so both apps consume the same
business rules; only rendering differs per platform.

## Testing

- Unit tests for `computeExpiryDate` (produce/non-produce/missing-manual-date
  cases) in `packages/core`.
- Unit tests for `archivePantryItem` / `updatePantryItem` against a test
  Supabase client (or mocked) covering the archive+log write.
- Manual verification via the `run-web` and `run-mobile` skills: add a
  produce item (expiry auto-computed), add a non-produce item (manual date
  required), edit an item and toggle produce on/off, mark an item consumed
  and expired, set notification preferences and confirm persistence, and
  visually confirm the location-grouped layout on both platforms.
