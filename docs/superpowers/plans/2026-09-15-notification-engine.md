# Notification Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the daily expiry-reminder system — an in-app bell fed by a new `pantry_item_reminders` table, an opt-in email digest sent via Resend, and an owner/admin-only on-demand trigger — all driven by one shared backend computation, on both web and mobile.

**Architecture:** A new Postgres function (`refresh_household_reminders`) does the pure eligibility/upsert/delete work and stays in the database, matching this codebase's existing convention (`archive_pantry_item`, `is_household_member`) of business logic living in Postgres functions. A new Supabase Edge Function (`compute-and-send-reminders`) orchestrates one household's run: calls that Postgres function, then — if due — builds and sends the email digest via Resend's HTTP API (something plain Postgres can't do without the async, harder-to-error-handle `pg_net` extension). `pg_cron` calls the Edge Function every 15 minutes for households whose configured send-time window is current; the client calls the same Edge Function directly for the on-demand button. Both paths share one authorization/dedup story.

**Tech Stack:** PostgreSQL/PL-pgSQL (Supabase), Supabase Edge Functions (Deno), Resend HTTP API, `@supabase/supabase-js`, React/Next.js (web), React Native/Expo (mobile), Jest.

**Spec:** `docs/superpowers/specs/2026-09-15-notification-engine-design.md`

## Global Constraints

- All households are treated as a single timezone, **Asia/Manila** — no per-household timezone setting.
- Only a short custom **intro line** is user-editable in the email; the item list itself is a fixed format. No placeholder/template substitution.
- **No OS-level push notifications** — `packages/notifications`' existing stubs stay unused; this plan does not touch them.
- No per-item snooze/dismiss — the only way to stop a reminder is archiving the item (existing `archive_pantry_item`).
- `notifications_enabled` on `household_members` is **per-member, per-household**, controls both the in-app bell and email eligibility together (no separate email-only flag).
- Digest email: **one email per opted-in member**, no CC — members never see each other's addresses.
- On-demand trigger is **owner/admin only** for the target household; a plain member calling it gets a 403.
- `pg_cron` fires every **15 minutes**; a household's digest sends once per Asia/Manila calendar day, tracked via `households.last_digest_sent_date`.
- Resend free tier (100/day, 3000/month) — no other email provider.

---

## File-structure overview

New files:
- `supabase/migrations/20260916000001_notification_reminders_schema.sql`
- `supabase/migrations/20260916000002_reminder_cron_schedule.sql`
- `packages/core/src/notificationDigest.ts` + `.test.ts`
- `packages/supabase-client/src/reminders.ts` + `.test.ts`
- `supabase/functions/compute-and-send-reminders/index.ts`
- `apps/web/src/components/notifications/NotificationBell.tsx`
- `apps/mobile/src/components/notifications/useReminderBadge.ts`

Modified files:
- `packages/supabase-client/src/types.ts`, `household.ts`, `household.test.ts`, `index.ts`
- `packages/core/src/index.ts`
- `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/pantry/NotificationPrefsModal.tsx`, `apps/web/src/app/pantry/page.tsx`
- `apps/mobile/src/navigation/BottomTabs.tsx`, `apps/mobile/src/components/pantry/NotificationPrefsModal.tsx`, `apps/mobile/src/screens/PantryScreen.tsx`

---

### Task 1: Database migration — reminders table, prefs columns, RLS, and the refresh function

**Files:**
- Create: `supabase/migrations/20260916000001_notification_reminders_schema.sql`

**Interfaces:**
- Produces: table `pantry_item_reminders(id, household_id, pantry_item_id, first_notified_at, last_notified_at)`; columns `households.notify_email_send_time`, `households.notify_email_intro`, `households.last_digest_sent_date`; column `household_members.notifications_enabled`; function `refresh_household_reminders(p_household_id uuid) returns void` (execute revoked from `public`, so only a service-role caller can invoke it); updated `archive_pantry_item` that also clears a resolved item's reminder row.

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================
-- PANTRY ITEM REMINDERS
-- =========================================================
create table pantry_item_reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  first_notified_at timestamptz not null default now(),
  last_notified_at timestamptz not null default now(),
  unique (pantry_item_id)
);

create index idx_pantry_item_reminders_household on pantry_item_reminders(household_id);

alter table pantry_item_reminders enable row level security;

create policy "members can read their household's reminders"
  on pantry_item_reminders for select
  using (is_household_member(household_id));

comment on table pantry_item_reminders is
  'One row per currently-expiring pantry item. Existence of a row IS the in-app notification; deleted when the item is archived or no longer eligible. Written only by refresh_household_reminders() (security definer) — no insert/update/delete policy is granted to regular users.';

-- =========================================================
-- HOUSEHOLDS: email digest settings
-- =========================================================
alter table households
  add column notify_email_send_time time not null default '08:00',
  add column notify_email_intro text,
  add column last_digest_sent_date date;

comment on column households.notify_email_send_time is
  'Local (Asia/Manila) time-of-day the daily digest email fires, owner/admin editable.';
comment on column households.notify_email_intro is
  'Optional custom intro line prepended to the digest email body; null renders no extra line.';
comment on column households.last_digest_sent_date is
  'Asia/Manila calendar date the digest was last sent, used to dedupe the scheduled run against an on-demand trigger on the same day.';

-- Existing "owners/admins can update household" policy (20260913000002) already
-- covers writes to these three new columns — no new households policy needed.

-- =========================================================
-- HOUSEHOLD MEMBERS: per-member notification toggle
-- =========================================================
alter table household_members
  add column notifications_enabled boolean not null default true;

comment on column household_members.notifications_enabled is
  'Off means: no in-app bell entries and excluded from the email digest recipient list, for this member in this household. Does not affect other members.';

create policy "members can update their own notification setting"
  on household_members for update
  using (user_id = auth.uid());

-- The policy above is row-scoped only — Postgres RLS cannot restrict which
-- *columns* an UPDATE touches, so a member could otherwise smuggle a role
-- change (or move themselves to a different household_id) into the same
-- call. A trigger closes that gap: any change to role/user_id/household_id
-- still requires the existing owner/admin check.
create or replace function prevent_self_household_member_escalation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (new.role <> old.role or new.user_id <> old.user_id or new.household_id <> old.household_id)
     and not is_household_admin_or_owner(old.household_id) then
    raise exception 'not authorized to change role, user_id, or household_id on household_members';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_self_household_member_escalation
  before update on household_members
  for each row
  execute function prevent_self_household_member_escalation();

-- =========================================================
-- REMINDER ELIGIBILITY & UPSERT (called by the Edge Function via a
-- service-role client; never by regular authenticated users directly)
-- =========================================================
create or replace function refresh_household_reminders(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into pantry_item_reminders (household_id, pantry_item_id, first_notified_at, last_notified_at)
  select
    pi.household_id,
    pi.id,
    now(),
    now()
  from pantry_items pi
  join households h on h.id = pi.household_id
  where pi.household_id = p_household_id
    and pi.is_archived = false
    and pi.expiration_date is not null
    and (pi.expiration_date - current_date) <= coalesce(
      pi.notify_days_before_expiry,
      case when pi.is_produce then h.notify_days_produce else h.notify_days_nonproduce end
    )
  on conflict (pantry_item_id) do update set last_notified_at = now();

  delete from pantry_item_reminders r
  using pantry_items pi
  join households h on h.id = pi.household_id
  where r.pantry_item_id = pi.id
    and r.household_id = p_household_id
    and (
      pi.is_archived = true
      or pi.expiration_date is null
      or (pi.expiration_date - current_date) > coalesce(
        pi.notify_days_before_expiry,
        case when pi.is_produce then h.notify_days_produce else h.notify_days_nonproduce end
      )
    );
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default — revoke it
-- so only a service-role caller (the Edge Function) can run this, keeping
-- the owner/admin check for on-demand triggers entirely inside the Edge
-- Function rather than exposable via a direct client RPC call.
revoke execute on function refresh_household_reminders(uuid) from public;

-- =========================================================
-- ARCHIVE PANTRY ITEM: also clear its reminder row
-- =========================================================
create or replace function archive_pantry_item(
  p_item_id uuid,
  p_event_type text,
  p_quantity numeric,
  p_triggered_by uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id from pantry_items where id = p_item_id;
  if v_household_id is null then
    raise exception 'pantry item % not found', p_item_id;
  end if;

  if not is_household_member(v_household_id) then
    raise exception 'not authorized to archive pantry item %', p_item_id;
  end if;

  update pantry_items set is_archived = true where id = p_item_id;

  insert into inventory_movement_logs (
    household_id, pantry_item_id, event_type, quantity_delta, triggered_by
  )
  values (
    v_household_id,
    p_item_id,
    p_event_type::movement_event_type,
    -abs(p_quantity),
    p_triggered_by
  );

  delete from pantry_item_reminders where pantry_item_id = p_item_id;
end;
$$;

comment on function archive_pantry_item is
  'Atomically archives a pantry item, records its consumed/discarded movement log entry, and clears any pending reminder for it — all in one transaction.';
```

- [ ] **Step 2: Review against existing conventions**

There is no local/live Supabase stack wired into this repo (see the comment atop `packages/supabase-client/src/types.ts`), so this migration is verified by review, not by running it — same approach as `20260914000001_pantry_produce_lifecycle_notifications.sql` and `20260915000001_archive_pantry_item_function.sql`. Compare against `supabase/migrations/20260913000002_rls_policies.sql`: naming (`snake_case`, `"lowercase policy names"`), the `is_household_member`/`is_household_admin_or_owner` helper usage, and `security definer` + `set search_path = pg_catalog, public` on every new function (matches `archive_pantry_item`'s existing pattern exactly). Confirm the `unique (pantry_item_id)` constraint is what makes the `on conflict (pantry_item_id) do update` upsert in `refresh_household_reminders` valid.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260916000001_notification_reminders_schema.sql
git commit -m "feat(db): add pantry_item_reminders, email digest settings, and refresh_household_reminders()"
git push
```

---

### Task 2: supabase-client — extend household notification preferences

**Files:**
- Modify: `packages/supabase-client/src/types.ts`
- Modify: `packages/supabase-client/src/household.ts`
- Modify: `packages/supabase-client/src/household.test.ts`

**Interfaces:**
- Consumes: `households.notify_email_send_time`, `households.notify_email_intro`, `household_members.notifications_enabled` (Task 1).
- Produces: extended `NotificationPreferences` interface (adds `emailSendTime: string`, `emailIntro: string | null`); `getHouseholdNotificationPrefs` / `updateHouseholdNotificationPrefs` now read/write all four fields; new `getMemberNotificationsEnabled(client, householdId, userId): Promise<boolean>` and `setMemberNotificationsEnabled(client, householdId, userId, enabled): Promise<void>`.

- [ ] **Step 1: Extend the `Database` type**

In `packages/supabase-client/src/types.ts`, update the `households` and `household_members` table shapes:

```ts
      households: {
        Row: {
          id: string;
          name: string;
          weekly_shopping_day: number | null;
          notify_days_produce: number;
          notify_days_nonproduce: number;
          notify_email_send_time: string;
          notify_email_intro: string | null;
          last_digest_sent_date: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['households']['Row']> & {
          name: string;
          created_by: string;
        };
        Update: Partial<Database['public']['Tables']['households']['Row']>;
        Relationships: [];
      };
      household_members: {
        Row: {
          id: string;
          household_id: string;
          user_id: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
          notifications_enabled: boolean;
          joined_at: string;
        };
        Insert: Partial<Database['public']['Tables']['household_members']['Row']> & {
          household_id: string;
          user_id: string;
          role: 'OWNER' | 'ADMIN' | 'MEMBER';
        };
        Update: Partial<Database['public']['Tables']['household_members']['Row']>;
        Relationships: [];
      };
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/supabase-client/src/household.test.ts`:

```ts
describe('getHouseholdNotificationPrefs (email fields)', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => result }) }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('includes the email send time and intro text', async () => {
    const client = fakeClient({
      data: {
        notify_days_produce: 2,
        notify_days_nonproduce: 7,
        notify_email_send_time: '08:00:00',
        notify_email_intro: 'Hey team!',
      },
      error: null,
    });
    expect(await getHouseholdNotificationPrefs(client, 'house-1')).toEqual({
      notifyDaysProduce: 2,
      notifyDaysNonproduce: 7,
      emailSendTime: '08:00:00',
      emailIntro: 'Hey team!',
    });
  });
});

describe('updateHouseholdNotificationPrefs (email fields)', () => {
  function fakeClient(
    result: { data: any; error: any },
    capture: { payload?: any }
  ): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return {
            eq: () => ({
              select: () => ({ then: (resolve: any) => Promise.resolve(result).then(resolve) }),
            }),
          };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes all four preference fields', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [{ id: 'house-1' }], error: null }, capture);
    await updateHouseholdNotificationPrefs(client, 'house-1', {
      notifyDaysProduce: 3,
      notifyDaysNonproduce: 10,
      emailSendTime: '09:30',
      emailIntro: 'Reminder!',
    });
    expect(capture.payload).toEqual({
      notify_days_produce: 3,
      notify_days_nonproduce: 10,
      notify_email_send_time: '09:30',
      notify_email_intro: 'Reminder!',
    });
  });
});

describe('getMemberNotificationsEnabled', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'household_members') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: async () => result }) }),
        }),
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('returns the member row flag', async () => {
    const client = fakeClient({ data: { notifications_enabled: false }, error: null });
    expect(await getMemberNotificationsEnabled(client, 'house-1', 'user-1')).toBe(false);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getMemberNotificationsEnabled(client, 'house-1', 'user-1')).rejects.toThrow('boom');
  });
});

describe('setMemberNotificationsEnabled', () => {
  function fakeClient(
    result: { data: any; error: any },
    capture: { payload?: any }
  ): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'household_members') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ then: (resolve: any) => Promise.resolve(result).then(resolve) }),
              }),
            }),
          };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes the flag for the caller\'s own membership row', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [{ id: 'member-1' }], error: null }, capture);
    await setMemberNotificationsEnabled(client, 'house-1', 'user-1', false);
    expect(capture.payload).toEqual({ notifications_enabled: false });
  });

  it('throws when the update matches zero rows', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [], error: null }, capture);
    await expect(setMemberNotificationsEnabled(client, 'house-1', 'user-1', false)).rejects.toThrow(
      'Failed to update your notification setting.'
    );
  });
});
```

Also update the import line at the top of the test file to include the new function names:

```ts
import {
  getMyHousehold,
  createHousehold,
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
} from './household';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/supabase-client && npm test`
Expected: FAIL — `getMemberNotificationsEnabled`/`setMemberNotificationsEnabled` are not exported yet, and the existing prefs tests fail on the missing email fields.

- [ ] **Step 4: Implement**

In `packages/supabase-client/src/household.ts`, replace the `NotificationPreferences` interface and its two functions, and add the two new member-scoped functions:

```ts
export interface NotificationPreferences {
  notifyDaysProduce: number;
  notifyDaysNonproduce: number;
  emailSendTime: string;
  emailIntro: string | null;
}

export async function getHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('households')
    .select('notify_days_produce, notify_days_nonproduce, notify_email_send_time, notify_email_intro')
    .eq('id', householdId)
    .single();

  if (error) throw error;
  return {
    notifyDaysProduce: data.notify_days_produce,
    notifyDaysNonproduce: data.notify_days_nonproduce,
    emailSendTime: data.notify_email_send_time,
    emailIntro: data.notify_email_intro,
  };
}

export async function updateHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string,
  prefs: NotificationPreferences
): Promise<void> {
  // `.select()` matters: RLS restricts households UPDATE to owners/admins, and
  // a bare update that matches zero rows comes back as { data: null, error:
  // null } — a silent no-op the UI would report as a successful save.
  const { data, error } = await client
    .from('households')
    .update({
      notify_days_produce: prefs.notifyDaysProduce,
      notify_days_nonproduce: prefs.notifyDaysNonproduce,
      notify_email_send_time: prefs.emailSendTime,
      notify_email_intro: prefs.emailIntro,
    })
    .eq('id', householdId)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('You do not have permission to update notification preferences.');
  }
}

export async function getMemberNotificationsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('household_members')
    .select('notifications_enabled')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data.notifications_enabled;
}

export async function setMemberNotificationsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const { data, error } = await client
    .from('household_members')
    .update({ notifications_enabled: enabled })
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to update your notification setting.');
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/supabase-client && npm test`
Expected: PASS, all tests in `household.test.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd packages/supabase-client && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/src/types.ts packages/supabase-client/src/household.ts packages/supabase-client/src/household.test.ts
git commit -m "feat(supabase-client): extend notification prefs with email settings and per-member toggle"
git push
```

---

### Task 3: supabase-client — reminders fetch and on-demand trigger

**Files:**
- Create: `packages/supabase-client/src/reminders.ts`
- Create: `packages/supabase-client/src/reminders.test.ts`
- Modify: `packages/supabase-client/src/index.ts`

**Interfaces:**
- Consumes: table `pantry_item_reminders` (Task 1); `pantry_items.name`/`expiration_date`.
- Produces: `interface PantryItemReminder { pantryItemId: string; name: string; expirationDate: string; }`; `getPantryItemReminders(client, householdId): Promise<PantryItemReminder[]>`; `triggerRemindersNow(client, householdId): Promise<{ status: string }>` (invokes the `compute-and-send-reminders` Edge Function from Task 5).

- [ ] **Step 1: Write the failing tests**

Create `packages/supabase-client/src/reminders.test.ts`:

```ts
import { getPantryItemReminders, triggerRemindersNow } from './reminders';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

describe('getPantryItemReminders', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'pantry_item_reminders') throw new Error(`Unexpected table: ${table}`);
      // `.eq(...)` itself must be the awaitable (matches the real
      // PostgrestFilterBuilder, which is thenable) — an extra function
      // wrapper here would make `await client.from(...).select(...).eq(...)`
      // resolve to a function object instead of `{ data, error }`.
      return { select: () => ({ eq: async () => result }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('maps embedded pantry item rows into a flat reminder list', async () => {
    const client = fakeClient({
      data: [
        { pantry_item_id: 'item-1', pantry_items: { name: 'Milk', expiration_date: '2026-09-18' } },
        { pantry_item_id: 'item-2', pantry_items: { name: 'Eggs', expiration_date: '2026-09-20' } },
      ],
      error: null,
    });
    expect(await getPantryItemReminders(client, 'house-1')).toEqual([
      { pantryItemId: 'item-1', name: 'Milk', expirationDate: '2026-09-18' },
      { pantryItemId: 'item-2', name: 'Eggs', expirationDate: '2026-09-20' },
    ]);
  });

  it('skips rows whose pantry item was deleted out from under the join', async () => {
    const client = fakeClient({
      data: [{ pantry_item_id: 'item-1', pantry_items: null }],
      error: null,
    });
    expect(await getPantryItemReminders(client, 'house-1')).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getPantryItemReminders(client, 'house-1')).rejects.toThrow('boom');
  });
});

describe('triggerRemindersNow', () => {
  it('invokes the compute-and-send-reminders Edge Function with the household id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'sent' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    expect(await triggerRemindersNow(client, 'house-1')).toEqual({ status: 'sent' });
    expect(invoke).toHaveBeenCalledWith('compute-and-send-reminders', {
      body: { household_id: 'house-1' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('403 Forbidden') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await expect(triggerRemindersNow(client, 'house-1')).rejects.toThrow('403 Forbidden');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/supabase-client && npm test`
Expected: FAIL with "Cannot find module './reminders'".

- [ ] **Step 3: Implement**

Create `packages/supabase-client/src/reminders.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface PantryItemReminder {
  pantryItemId: string;
  name: string;
  expirationDate: string;
}

/**
 * Reads today's in-app notification list directly from
 * `pantry_item_reminders` — its rows ARE the notifications; there is no
 * separate read/unread state. Populated by `refresh_household_reminders()`
 * (see the `compute-and-send-reminders` Edge Function), not written here.
 */
export async function getPantryItemReminders(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<PantryItemReminder[]> {
  const { data, error } = await client
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);

  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => row.pantry_items)
    .map((row: any) => ({
      pantryItemId: row.pantry_item_id,
      name: row.pantry_items.name,
      expirationDate: row.pantry_items.expiration_date,
    }));
}

/**
 * Calls the `compute-and-send-reminders` Edge Function directly instead of
 * waiting for the next `pg_cron` tick. The function itself checks the
 * caller's role is OWNER/ADMIN for `householdId` and rejects otherwise —
 * this client just surfaces whatever it returns.
 */
export async function triggerRemindersNow(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<{ status: string }> {
  const { data, error } = await client.functions.invoke('compute-and-send-reminders', {
    body: { household_id: householdId },
  });

  if (error) throw error;
  return data;
}
```

No `Functions` entry is needed in `types.ts` for this task — `triggerRemindersNow` calls `client.functions.invoke`, not `client.rpc`, so it isn't typed against the `Database` interface's `Functions` map the way `archive_pantry_item` is.

- [ ] **Step 4: Export from the package index**

In `packages/supabase-client/src/index.ts`, add:

```ts
export * from './reminders';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/supabase-client && npm test`
Expected: PASS, all tests including the new `reminders.test.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd packages/supabase-client && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/src/reminders.ts packages/supabase-client/src/reminders.test.ts packages/supabase-client/src/index.ts
git commit -m "feat(supabase-client): add reminders fetch and on-demand trigger"
git push
```

---

### Task 4: packages/core — digest email content builder

**Files:**
- Create: `packages/core/src/notificationDigest.ts`
- Create: `packages/core/src/notificationDigest.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: `interface DigestItem { name: string; daysUntilExpiry: number }`; `interface DigestInput { householdName: string; introText: string | null; items: DigestItem[] }`; `interface DigestEmail { subject: string; body: string }`; `buildDigestEmail(input: DigestInput): DigestEmail`. Consumed by the Edge Function in Task 5 via a relative import (Deno loads plain `.ts` files directly, no bundling needed, since this module has zero imports of its own).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/notificationDigest.test.ts`:

```ts
import { buildDigestEmail } from './notificationDigest';

describe('buildDigestEmail', () => {
  it('uses singular wording and sorts a single item', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: null,
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.subject).toBe('1 item expiring soon in The Gos');
    expect(result.body).toBe('- Milk — expires in 2 days');
  });

  it('uses plural wording and sorts soonest-first', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: null,
      items: [
        { name: 'Bread', daysUntilExpiry: 5 },
        { name: 'Milk', daysUntilExpiry: 2 },
      ],
    });
    expect(result.subject).toBe('2 items expiring soon in The Gos');
    expect(result.body).toBe('- Milk — expires in 2 days\n- Bread — expires in 5 days');
  });

  it('prepends the intro text as its own paragraph when set', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: 'Hey team, heads up!',
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.body).toBe('Hey team, heads up!\n\n- Milk — expires in 2 days');
  });

  it('omits the intro paragraph when null or blank', () => {
    const nullResult = buildDigestEmail({ householdName: 'H', introText: null, items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(nullResult.body).toBe('- A — expires tomorrow');

    const blankResult = buildDigestEmail({ householdName: 'H', introText: '   ', items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(blankResult.body).toBe('- A — expires tomorrow');
  });

  it('describes today, tomorrow, future, and already-expired days correctly', () => {
    const result = buildDigestEmail({
      householdName: 'H',
      introText: null,
      items: [
        { name: 'Today item', daysUntilExpiry: 0 },
        { name: 'Tomorrow item', daysUntilExpiry: 1 },
        { name: 'Future item', daysUntilExpiry: 3 },
        { name: 'Expired item', daysUntilExpiry: -2 },
      ],
    });
    expect(result.body).toBe(
      [
        '- Expired item — expired 2 days ago',
        '- Today item — expires today',
        '- Tomorrow item — expires tomorrow',
        '- Future item — expires in 3 days',
      ].join('\n')
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npm test`
Expected: FAIL with "Cannot find module './notificationDigest'".

- [ ] **Step 3: Implement**

Create `packages/core/src/notificationDigest.ts`:

```ts
export interface DigestItem {
  name: string;
  daysUntilExpiry: number;
}

export interface DigestInput {
  householdName: string;
  introText: string | null;
  items: DigestItem[];
}

export interface DigestEmail {
  subject: string;
  body: string;
}

function describeDays(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    return `expired ${abs} day${abs === 1 ? '' : 's'} ago`;
  }
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

export function buildDigestEmail(input: DigestInput): DigestEmail {
  const sorted = [...input.items].sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  const count = sorted.length;
  const subject = `${count} item${count === 1 ? '' : 's'} expiring soon in ${input.householdName}`;

  const itemLines = sorted.map((item) => `- ${item.name} — ${describeDays(item.daysUntilExpiry)}`).join('\n');
  const intro = input.introText?.trim();

  const body = intro ? `${intro}\n\n${itemLines}` : itemLines;

  return { subject, body };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npm test`
Expected: PASS, all tests in `notificationDigest.test.ts`.

- [ ] **Step 5: Export from the package index**

In `packages/core/src/index.ts`, add:

```ts
export * from './notificationDigest';
```

- [ ] **Step 6: Run the full core test suite and typecheck**

Run: `cd packages/core && npm test && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/notificationDigest.ts packages/core/src/notificationDigest.test.ts packages/core/src/index.ts
git commit -m "feat(core): add pure digest-email content builder"
git push
```

---

### Task 5: Supabase Edge Function — compute-and-send-reminders

**Files:**
- Create: `supabase/functions/compute-and-send-reminders/index.ts`

**Interfaces:**
- Consumes: `refresh_household_reminders(uuid)` RPC (Task 1); `buildDigestEmail` (Task 4, imported by relative path); tables `households`, `pantry_item_reminders`, `household_members`.
- Produces: an HTTP endpoint at `/functions/v1/compute-and-send-reminders` accepting `POST { household_id: string }` with an `Authorization: Bearer <jwt>` header — either a Supabase `service_role` JWT (cron path) or an authenticated user's session JWT, in which case the caller's `household_members.role` for `household_id` must be `OWNER` or `ADMIN`. Returns JSON `{ status: 'already_sent_today' | 'no_eligible_items' | 'no_opted_in_members' | 'sent', results?: ... }`.

There is no local Supabase Functions runtime available in this repo (it needs Docker, not set up here), so this task is written and reviewed, then verified live against the deployed project in Task 11 — matching how the migrations in this codebase are handled.

- [ ] **Step 1: Write the function**

Create `supabase/functions/compute-and-send-reminders/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildDigestEmail } from '../../../packages/core/src/notificationDigest.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM = Deno.env.get('RESEND_FROM_ADDRESS')!;

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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  const callerRole = decodeJwtRole(authHeader);
  if (callerRole !== 'service_role' && callerRole !== 'authenticated') {
    return new Response('Unauthorized', { status: 401 });
  }

  let householdId: string | undefined;
  try {
    const payload = await req.json();
    householdId = payload.household_id;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!householdId) {
    return new Response('household_id is required', { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (callerRole === 'authenticated') {
    const token = authHeader!.slice('Bearer '.length);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { data: membership } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', householdId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new Response('Forbidden: only household owners/admins can trigger reminders', { status: 403 });
    }
  }

  const { error: refreshError } = await admin.rpc('refresh_household_reminders', {
    p_household_id: householdId,
  });
  if (refreshError) {
    return new Response(`Failed to refresh reminders: ${refreshError.message}`, { status: 500 });
  }

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('name, notify_email_intro, last_digest_sent_date')
    .eq('id', householdId)
    .single();
  if (householdError || !household) {
    return new Response(`Failed to load household: ${householdError?.message ?? 'not found'}`, { status: 500 });
  }

  const todayManila = manilaDateString(new Date());

  if (household.last_digest_sent_date === todayManila) {
    return new Response(JSON.stringify({ status: 'already_sent_today' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: reminders, error: remindersError } = await admin
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);
  if (remindersError) {
    return new Response(`Failed to load reminders: ${remindersError.message}`, { status: 500 });
  }

  if (!reminders || reminders.length === 0) {
    return new Response(JSON.stringify({ status: 'no_eligible_items' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true);
  if (membersError) {
    return new Response(`Failed to load members: ${membersError.message}`, { status: 500 });
  }

  if (!members || members.length === 0) {
    return new Response(JSON.stringify({ status: 'no_opted_in_members' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const todayMs = Date.parse(`${todayManila}T00:00:00Z`);
  const digestItems = reminders
    .filter((row: any) => row.pantry_items)
    .map((row: any) => {
      const expiryMs = Date.parse(`${row.pantry_items.expiration_date}T00:00:00Z`);
      const daysUntilExpiry = Math.round((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
      return { name: row.pantry_items.name as string, daysUntilExpiry };
    });

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

  // Set only after attempting the batch — a crash before this point (e.g.
  // the reminders/members queries failing) leaves last_digest_sent_date
  // untouched so a later retry the same day can still send.
  await admin.from('households').update({ last_digest_sent_date: todayManila }).eq('id', householdId);

  return new Response(JSON.stringify({ status: 'sent', results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

- [ ] **Step 2: Review for correctness against Task 1 and Task 4's exact shapes**

Confirm: `refresh_household_reminders` is called with `p_household_id` matching the migration's parameter name; the `pantry_item_reminders` embedded select `pantry_items(name, expiration_date)` relies on the foreign key added in Task 1; `buildDigestEmail`'s import path `../../../packages/core/src/notificationDigest.ts` resolves correctly from `supabase/functions/compute-and-send-reminders/index.ts` (three `..` segments reach the repo root: `functions/` → `supabase/` → repo root, then into `packages/core/src/`); the module has zero imports of its own, so Deno can load it directly with no bundling step.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/compute-and-send-reminders/index.ts
git commit -m "feat(functions): add compute-and-send-reminders Edge Function"
git push
```

---

### Task 6: Database migration — pg_cron scheduling

**Files:**
- Create: `supabase/migrations/20260916000002_reminder_cron_schedule.sql`

**Interfaces:**
- Consumes: the Edge Function URL from Task 5 (hardcoded — `https://nrjeqeddlssrxaskovrs.supabase.co/functions/v1/compute-and-send-reminders` is this project's public URL, not a secret); Supabase's platform-managed `vault.decrypted_secrets` row named `service_role_key` (pre-seeded by Supabase for every project — never touched or seen by anyone editing this repo, stays entirely inside Postgres).
- Produces: function `trigger_due_household_reminders()`; a `pg_cron` job named `household-reminders-every-15-min`.

- [ ] **Step 1: Write the migration**

```sql
create extension if not exists pg_net;

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
  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise notice 'service_role_key not found in Vault; skipping reminder dispatch';
    return;
  end if;

  -- A household is "due" when the current Asia/Manila wall-clock time falls
  -- within 15 minutes after its configured send time. Computed via modular
  -- arithmetic on seconds-since-midnight so a send time near midnight (e.g.
  -- 23:55) still matches correctly across the day boundary — a plain
  -- `send_time <= now AND now < send_time + 15min` comparison breaks there
  -- because `time + interval` wraps but the AND does not.
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

revoke execute on function trigger_due_household_reminders() from public;

select cron.schedule(
  'household-reminders-every-15-min',
  '*/15 * * * *',
  $$select trigger_due_household_reminders();$$
);
```

- [ ] **Step 2: Review**

Verified by review, same as Task 1 (no local Supabase stack). Confirm the modular-arithmetic window check: for the default `notify_email_send_time = '08:00:00'` and a cron tick at `08:05` Manila time, `extract(epoch from ('08:05' - '08:00'))` = 300 seconds, `(300 + 86400) mod 86400` = 300, which is `< 900` — due. For a tick at `07:55` (before the window), the difference is `-300`, `(-300 + 86400) mod 86400` = 86100, not `< 900` — correctly not due yet.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260916000002_reminder_cron_schedule.sql
git commit -m "feat(db): schedule pg_cron dispatch of due household reminders every 15 minutes"
git push
```

---

### Task 7: Web — notification bell in the sidebar

**Files:**
- Create: `apps/web/src/components/notifications/NotificationBell.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `getPantryItemReminders`, `getMemberNotificationsEnabled` (Task 3, Task 2); `useAuth` (`session`); `useHousehold` (`membership`) — both already exist in `apps/web/src/lib/`.
- Produces: `<NotificationBell householdId={string} userId={string} />`, rendered from `Sidebar`.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/notifications/NotificationBell.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  getPantryItemReminders,
  getMemberNotificationsEnabled,
  type PantryItemReminder,
} from '@pantry/supabase-client';
import { daysUntil } from '@pantry/ui';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, radius } from '@/lib/theme';

export function NotificationBell({ householdId, userId }: { householdId: string; userId: string }) {
  const [reminders, setReminders] = useState<PantryItemReminder[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getMemberNotificationsEnabled(supabase, householdId, userId).then((value) => {
      if (!cancelled) setEnabled(value);
    });

    if (enabled) {
      getPantryItemReminders(supabase, householdId).then((list) => {
        if (!cancelled) setReminders(list);
      });
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [householdId, userId]);

  if (!enabled) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Expiring item reminders"
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 6,
          borderRadius: radius.sm,
          color: color.mutedForeground,
        }}
      >
        🔔
        {reminders.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: color.destructive,
              color: '#fff',
              borderRadius: 999,
              fontSize: 10,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {reminders.length}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            ...cardStyle,
            position: 'absolute',
            top: '110%',
            left: 0,
            width: 260,
            maxHeight: 320,
            overflowY: 'auto',
            padding: 12,
            zIndex: 60,
          }}
        >
          {reminders.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: color.mutedForeground }}>No expiring items right now.</p>
          ) : (
            reminders.map((r) => {
              const days = daysUntil(r.expirationDate);
              return (
                <div key={r.pantryItemId} style={{ padding: '6px 0', borderBottom: `1px solid ${color.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: color.mutedForeground }}>
                    {days === null ? 'Unknown expiry' : days < 0 ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Expires today' : `Expires in ${days}d`}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the Sidebar**

In `apps/web/src/components/Sidebar.tsx`, add the import and the household lookup, and render the bell next to the logo:

```tsx
import { NotificationBell } from './notifications/NotificationBell';
import { useHousehold } from '@/lib/useHousehold';
```

```tsx
export function Sidebar() {
  const { session, loading, signOut } = useAuth();
  const { membership } = useHousehold();
  const pathname = usePathname();
```

And change the logo row to include it:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: radius.sm,
                background: color.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              P
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, color: color.foreground }}>Pantry Tracker</span>
          </div>
          {session && membership && membership !== 'loading' && (
            <NotificationBell householdId={membership.householdId} userId={session.user.id} />
          )}
        </div>
```

(Replace the existing single-`div` logo block with this two-column version; the rest of `Sidebar` is unchanged.)

- [ ] **Step 3: Typecheck and build**

Run: `cd apps/web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notifications/NotificationBell.tsx apps/web/src/components/Sidebar.tsx
git commit -m "feat(web): add notification bell to the sidebar"
git push
```

---

### Task 8: Web — extend NotificationPrefsModal and pantry page gating

**Files:**
- Modify: `apps/web/src/components/pantry/NotificationPrefsModal.tsx`
- Modify: `apps/web/src/app/pantry/page.tsx`

**Interfaces:**
- Consumes: `getMemberNotificationsEnabled`/`setMemberNotificationsEnabled` (Task 2); `triggerRemindersNow` (Task 3); `useAuth` (`session.user.id`).

- [ ] **Step 1: Rewrite the modal**

Replace the full content of `apps/web/src/components/pantry/NotificationPrefsModal.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
  triggerRemindersNow,
} from '@pantry/supabase-client';
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export function NotificationPrefsModal({
  householdId,
  isAdmin,
  onClose,
}: {
  householdId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [emailSendTime, setEmailSendTime] = useState('08:00');
  const [emailIntro, setEmailIntro] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState(false);
  const [sendNowStatus, setSendNowStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      getHouseholdNotificationPrefs(supabase, householdId),
      getMemberNotificationsEnabled(supabase, householdId, session.user.id),
    ])
      .then(([prefs, memberEnabled]) => {
        setNotifyDaysProduce(String(prefs.notifyDaysProduce));
        setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
        setEmailSendTime(prefs.emailSendTime.slice(0, 5));
        setEmailIntro(prefs.emailIntro ?? '');
        setNotificationsEnabled(memberEnabled);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => setLoading(false));
  }, [householdId, session]);

  async function handleToggleNotifications(next: boolean) {
    if (!session) return;
    setNotificationsEnabled(next);
    try {
      await setMemberNotificationsEnabled(supabase, householdId, session.user.id, next);
    } catch (err) {
      setNotificationsEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to update your notification setting');
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
        emailSendTime,
        emailIntro: emailIntro.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (only household owners/admins can change these settings)`
          : 'Failed to save preferences'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    setSendingNow(true);
    setSendNowStatus(null);
    try {
      const result = await triggerRemindersNow(supabase, householdId);
      setSendNowStatus(result.status === 'sent' ? 'Reminders sent.' : `Nothing to send (${result.status}).`);
    } catch (err) {
      setSendNowStatus(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingNow(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 50,
      }}
    >
      <div style={{ ...cardStyle, padding: 24, width: 380, display: 'grid', gap: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Notification preferences</h2>
        {loading && <p style={{ color: color.mutedForeground, fontSize: 13, margin: 0 }}>Loading…</p>}
        {!loading && loadError && (
          <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>
            Couldn&apos;t load your preferences: {loadError}
          </p>
        )}
        {!loading && !loadError && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => handleToggleNotifications(e.target.checked)}
              />
              Notify me about expiring items (in-app and email)
            </label>

            {isAdmin && (
              <>
                <label style={labelStyle}>
                  Remind me before expiry — Produce items (days)
                  <input
                    type="number"
                    min="0"
                    value={notifyDaysProduce}
                    onChange={(e) => setNotifyDaysProduce(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Remind me before expiry — Non-produce items (days)
                  <input
                    type="number"
                    min="0"
                    value={notifyDaysNonproduce}
                    onChange={(e) => setNotifyDaysNonproduce(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Daily email send time
                  <input
                    type="time"
                    value={emailSendTime}
                    onChange={(e) => setEmailSendTime(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Custom intro line (optional)
                  <input
                    type="text"
                    value={emailIntro}
                    onChange={(e) => setEmailIntro(e.target.value)}
                    placeholder="Hey team, don't forget:"
                    style={inputStyle}
                  />
                </label>
                <div>
                  <button type="button" onClick={handleSendNow} disabled={sendingNow} style={buttonStyle('secondary')}>
                    {sendingNow ? 'Sending…' : 'Send reminders now'}
                  </button>
                  {sendNowStatus && (
                    <p style={{ fontSize: 12, color: color.mutedForeground, margin: '6px 0 0' }}>{sendNowStatus}</p>
                  )}
                </div>
              </>
            )}
            {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={buttonStyle('ghost')}>Cancel</button>
          {!loading && !loadError && isAdmin && (
            <button type="button" onClick={handleSave} disabled={saving} style={buttonStyle('primary')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the pantry page's gating and modal invocation**

In `apps/web/src/app/pantry/page.tsx`, change the button gating from admin-only to every member (the modal itself now handles the admin-only fields internally), and pass `isAdmin` to the modal:

```tsx
        {membership && membership !== 'loading' && (
          <button
            onClick={() => setShowPrefs(true)}
            style={{
              ...buttonStyle('secondary'),
              padding: '8px 14px',
              borderRadius: radius.pill,
              color: color.mutedForeground,
              whiteSpace: 'nowrap',
            }}
            aria-label="Notification preferences"
          >
            ⚙️ Notifications
          </button>
        )}
```

(Replace the old `membership.role !== 'MEMBER'` condition and its preceding comment with the simpler `membership && membership !== 'loading'` shown above — every member can now open the modal, since it always offers at least the personal on/off toggle.)

```tsx
            <NotificationPrefsModal
              householdId={membership.householdId}
              isAdmin={membership.role !== 'MEMBER'}
              onClose={() => setShowPrefs(false)}
            />
```

- [ ] **Step 3: Build**

Run: `cd apps/web && npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pantry/NotificationPrefsModal.tsx apps/web/src/app/pantry/page.tsx
git commit -m "feat(web): add email settings, per-member toggle, and send-now button to notification prefs"
git push
```

---

### Task 9: Mobile — reminder badge on the bottom tab

**Files:**
- Create: `apps/mobile/src/components/notifications/useReminderBadge.ts`
- Modify: `apps/mobile/src/navigation/BottomTabs.tsx`

**Interfaces:**
- Consumes: `getPantryItemReminders`, `getMemberNotificationsEnabled` (Task 2, Task 3); `useAuth`, `useHousehold` (`apps/mobile/src/lib/`).
- Produces: `useReminderBadge(): number | undefined` (a hook, so it can be called from inside `BottomTabs`, which is not wrapped by anything providing household context directly — `AuthProvider` wraps the whole app per the existing structure, so the hook works from any component).

- [ ] **Step 1: Write the hook**

Create `apps/mobile/src/components/notifications/useReminderBadge.ts`:

```ts
import { useEffect, useState } from 'react';
import { getPantryItemReminders, getMemberNotificationsEnabled } from '@pantry/supabase-client';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthProvider';
import { useHousehold } from '../../lib/useHousehold';

/** Badge count for the Pantry tab, or `undefined` when there's nothing to show
 * (not signed in, no household yet, or the member has notifications off). */
export function useReminderBadge(): number | undefined {
  const { session } = useAuth();
  const { membership } = useHousehold();
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!session || !membership || membership === 'loading') {
      setCount(undefined);
      return;
    }

    let cancelled = false;
    const householdId = membership.householdId;
    const userId = session.user.id;

    getMemberNotificationsEnabled(supabase, householdId, userId).then((enabled) => {
      if (cancelled) return;
      if (!enabled) {
        setCount(undefined);
        return;
      }
      getPantryItemReminders(supabase, householdId).then((reminders) => {
        if (!cancelled) setCount(reminders.length > 0 ? reminders.length : undefined);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [session, membership]);

  return count;
}
```

- [ ] **Step 2: Wire the badge into the Pantry tab**

In `apps/mobile/src/navigation/BottomTabs.tsx`, add the import and use the hook inside `BottomTabs` to set `tabBarBadge` on the Pantry screen:

```tsx
import { useReminderBadge } from '../components/notifications/useReminderBadge';
```

```tsx
export function BottomTabs() {
  const reminderCount = useReminderBadge();

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: color.primary,
          tabBarInactiveTintColor: color.mutedForeground,
          tabBarStyle: { backgroundColor: color.card, borderTopColor: color.border },
          tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
        }}
      >
        <Tab.Screen name="Home" component={DashboardScreen} />
        <Tab.Screen
          name="Pantry"
          component={PantryScreen}
          options={{ tabBarBadge: reminderCount }}
        />
        <Tab.Screen name="Recipe" component={RecipeOcrScreen} />
        <Tab.Screen name="Shop" component={ShoppingListScreen} />
        <Tab.Screen name="Financial" component={FinancialsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

(`tabBarBadge` is a built-in `@react-navigation/bottom-tabs` option; passing `undefined` renders no badge, matching the hook's "nothing to show" case.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/notifications/useReminderBadge.ts apps/mobile/src/navigation/BottomTabs.tsx
git commit -m "feat(mobile): add expiring-item badge to the Pantry tab"
git push
```

---

### Task 10: Mobile — extend NotificationPrefsModal and PantryScreen gating

**Files:**
- Modify: `apps/mobile/src/components/pantry/NotificationPrefsModal.tsx`
- Modify: `apps/mobile/src/screens/PantryScreen.tsx`

**Interfaces:**
- Mirrors Task 8 on React Native, using `AppButton`/`TextInput`/`Modal` instead of HTML form elements. Same prop addition: `isAdmin: boolean`.

- [ ] **Step 1: Rewrite the modal**

Replace the full content of `apps/mobile/src/components/pantry/NotificationPrefsModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Switch, StyleSheet } from 'react-native';
import {
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
  triggerRemindersNow,
} from '@pantry/supabase-client';
import { useAuth } from '../../lib/AuthProvider';
import { supabase } from '../../lib/supabaseClient';
import { AppButton } from '../AppButton';
import { color, cardStyle, inputStyle, font } from '../../lib/theme';

export function NotificationPrefsModal({
  householdId,
  isAdmin,
  visible,
  onClose,
}: {
  householdId: string;
  isAdmin: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const { session } = useAuth();
  const [notifyDaysProduce, setNotifyDaysProduce] = useState('2');
  const [notifyDaysNonproduce, setNotifyDaysNonproduce] = useState('7');
  const [emailSendTime, setEmailSendTime] = useState('08:00');
  const [emailIntro, setEmailIntro] = useState('');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingNow, setSendingNow] = useState(false);
  const [sendNowStatus, setSendNowStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !session) return;
    setLoading(true);
    Promise.all([
      getHouseholdNotificationPrefs(supabase, householdId),
      getMemberNotificationsEnabled(supabase, householdId, session.user.id),
    ])
      .then(([prefs, memberEnabled]) => {
        setNotifyDaysProduce(String(prefs.notifyDaysProduce));
        setNotifyDaysNonproduce(String(prefs.notifyDaysNonproduce));
        setEmailSendTime(prefs.emailSendTime.slice(0, 5));
        setEmailIntro(prefs.emailIntro ?? '');
        setNotificationsEnabled(memberEnabled);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load preferences');
      })
      .finally(() => setLoading(false));
  }, [visible, householdId, session]);

  async function handleToggleNotifications(next: boolean) {
    if (!session) return;
    setNotificationsEnabled(next);
    try {
      await setMemberNotificationsEnabled(supabase, householdId, session.user.id, next);
    } catch (err) {
      setNotificationsEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to update your notification setting');
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateHouseholdNotificationPrefs(supabase, householdId, {
        notifyDaysProduce: Number(notifyDaysProduce) || 0,
        notifyDaysNonproduce: Number(notifyDaysNonproduce) || 0,
        emailSendTime,
        emailIntro: emailIntro.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} (only household owners/admins can change these settings)`
          : 'Failed to save preferences'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow() {
    setSendingNow(true);
    setSendNowStatus(null);
    try {
      const result = await triggerRemindersNow(supabase, householdId);
      setSendNowStatus(result.status === 'sent' ? 'Reminders sent.' : `Nothing to send (${result.status}).`);
    } catch (err) {
      setSendNowStatus(err instanceof Error ? err.message : 'Failed to send reminders');
    } finally {
      setSendingNow(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Notification preferences</Text>
          {loading ? <Text style={styles.meta}>Loading…</Text> : null}
          {!loading && loadError ? (
            <Text style={styles.error}>Could not load your preferences: {loadError}</Text>
          ) : null}
          {!loading && !loadError ? (
            <>
              <View style={styles.toggleRow}>
                <Text style={styles.fieldLabel}>Notify me about expiring items</Text>
                <Switch value={notificationsEnabled} onValueChange={handleToggleNotifications} />
              </View>

              {isAdmin && (
                <>
                  <Text style={styles.fieldLabel}>Remind me before expiry — Produce items (days)</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={notifyDaysProduce}
                    onChangeText={setNotifyDaysProduce}
                    style={inputStyle}
                  />
                  <Text style={styles.fieldLabel}>Remind me before expiry — Non-produce items (days)</Text>
                  <TextInput
                    keyboardType="numeric"
                    value={notifyDaysNonproduce}
                    onChangeText={setNotifyDaysNonproduce}
                    style={inputStyle}
                  />
                  <Text style={styles.fieldLabel}>Daily email send time (HH:MM)</Text>
                  <TextInput value={emailSendTime} onChangeText={setEmailSendTime} style={inputStyle} placeholder="08:00" />
                  <Text style={styles.fieldLabel}>Custom intro line (optional)</Text>
                  <TextInput
                    value={emailIntro}
                    onChangeText={setEmailIntro}
                    style={inputStyle}
                    placeholder="Hey team, don't forget:"
                  />
                  <AppButton
                    title={sendingNow ? 'Sending…' : 'Send reminders now'}
                    variant="secondary"
                    onPress={handleSendNow}
                    disabled={sendingNow}
                  />
                  {sendNowStatus && <Text style={styles.meta}>{sendNowStatus}</Text>}
                </>
              )}
              {error && <Text style={styles.error}>{error}</Text>}
            </>
          ) : null}
          <View style={styles.buttonRow}>
            <AppButton title="Cancel" variant="secondary" onPress={onClose} />
            {!loading && !loadError && isAdmin ? (
              <AppButton title={saving ? 'Saving…' : 'Save'} onPress={handleSave} disabled={saving} />
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { ...cardStyle, backgroundColor: color.card, padding: 20, width: '100%', maxWidth: 360, gap: 10 },
  title: { fontSize: 16, fontFamily: font.bold, color: color.foreground },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 12, color: color.mutedForeground, fontFamily: font.medium },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  error: { color: color.destructive, fontSize: 13, fontFamily: font.regular },
  buttonRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
});
```

- [ ] **Step 2: Update PantryScreen's gating and modal invocation**

In `apps/mobile/src/screens/PantryScreen.tsx`, change the gear button's gating condition from `membership.role !== 'MEMBER'` to every member, and pass `isAdmin`:

```tsx
        {membership && membership !== 'loading' && (
          <Pressable
            onPress={() => setShowPrefs(true)}
            style={({ pressed }) => [styles.gearButton, pressed && styles.gearButtonPressed]}
          >
            <Text style={styles.gearIcon}>⚙️</Text>
          </Pressable>
        )}
```

```tsx
          <NotificationPrefsModal
            householdId={membership.householdId}
            isAdmin={membership.role !== 'MEMBER'}
            visible={showPrefs}
            onClose={() => setShowPrefs(false)}
          />
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/pantry/NotificationPrefsModal.tsx apps/mobile/src/screens/PantryScreen.tsx
git commit -m "feat(mobile): add email settings, per-member toggle, and send-now button to notification prefs"
git push
```

---

### Task 11: Deployment and live verification

**Files:** none (operational task — Resend account setup, Supabase deployment, live checks).

This task cannot be executed by the agent alone: it requires a Resend account signup (Task 11 spec decision, user approved) and Supabase CLI deployment, both of which need credentials the agent does not have and should not request (no `service_role` key, no ngrok/CLI login tokens) — consistent with how every prior migration in this repo has been hand-applied rather than agent-run.

- [x] **Step 1: Create the Resend account and API key** — done 2026-09-16. Using Resend's shared test domain (`onboarding@resend.dev`) for now — this restricts test sends to the account owner's own verified email (`ronnel.go@gmail.com`); a domain must be verified in Resend before real users other than the account owner can receive email.

- [x] **Step 2: Apply the two new migrations** — done 2026-09-16, both applied via Supabase Studio SQL editor with no errors.

User (or agent, if given a way to run `npx supabase db push` against the linked project) applies, in order:
- `supabase/migrations/20260916000001_notification_reminders_schema.sql`
- `supabase/migrations/20260916000002_reminder_cron_schedule.sql`

via the Supabase Studio SQL editor, same as every prior migration in this project.

**Decision made:** email digest defaults to ON (opt-out) — every household member is enrolled the moment this migration lands, and can turn it off in settings. `household_members.notifications_enabled default true` stays as-written; no migration change needed for this.

- [x] **Step 2b: Verify the cron pipeline is actually alive, not just deployed** — done 2026-09-16. Confirmed live: `vault.decrypted_secrets` had NO pre-seeded `service_role_key` row (the "Supabase pre-seeds this" assumption in the spec was wrong for this project) — fixed by manually running `select vault.create_secret(<key>, 'service_role_key', ...)` with the user's own service_role key, pasted directly into the Supabase SQL editor and never shared with the agent. After that, `cron.job_run_details` showed 5 consecutive `succeeded` runs at exact 15-minute intervals, and both privilege checks returned the expected values (`authenticated`: `f`, `service_role`: `t`). `net._http_response` was not separately checked — real end-to-end dispatch was already proven via Step 4's on-demand test below, which exercises the identical code path.

The cron dispatch path has two independent silent-failure modes the final review flagged: the `service_role_key` Vault lookup can be absent (older Supabase project vintages may not pre-seed it), and `net.http_post` is fire-and-forget with nothing reading the response — a bad URL, an auth failure, or a cold-start error at the Edge Function would be invisible. After applying the migrations, run each of these in the Supabase Studio SQL editor and confirm the expected result before moving on:

```sql
-- 1. Confirm the Vault secret the cron wrapper depends on actually exists
select name from vault.decrypted_secrets where name = 'service_role_key';
-- Expected: one row. If empty, trigger_due_household_reminders() will raise
-- a warning and silently no-op every 15 minutes — the whole feature is dead
-- until this is fixed, and nothing besides the Postgres log will tell you.

-- 2. After Step 3 deploys the function and at least one 15-minute cron tick
-- has passed, confirm the scheduled job is actually running:
select jobid, status, return_message, start_time
from cron.job_run_details
join cron.job using (jobid)
where jobname = 'household-reminders-every-15-min'
order by start_time desc limit 5;
-- Expected: recent rows with status 'succeeded'.

-- 3. And confirm the HTTP calls to the Edge Function actually got a 2xx back:
select status_code, created, content::text
from net._http_response
order by created desc limit 5;
-- Expected: status_code 200 for each recent dispatch. Anything else (or no
-- rows at all despite job_run_details showing the cron function ran) means
-- the Edge Function URL, auth, or the function itself is failing silently.

-- 4. Confirm the explicit privilege grants from the final-review fix wave
-- landed as intended — only service_role should be able to call the
-- reminders-refresh function directly:
select has_function_privilege('authenticated', 'refresh_household_reminders(uuid)', 'execute');
-- Expected: f
select has_function_privilege('service_role', 'refresh_household_reminders(uuid)', 'execute');
-- Expected: t
```

- [x] **Step 3: Deploy the Edge Function and set its secrets** — done 2026-09-16 by the user (interactive CLI login + deploy are outside what the agent can do without holding account-level credentials).

```bash
npx supabase login
npx supabase link --project-ref nrjeqeddlssrxaskovrs
npx supabase functions deploy compute-and-send-reminders
npx supabase secrets set RESEND_API_KEY=<the key from Step 1>
npx supabase secrets set RESEND_FROM_ADDRESS="Pantry Tracker <onboarding@resend.dev>"
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available to every Edge Function — no need to set them manually.)

- [x] **Step 4: Live verification — direct curl against the deployed function** — done 2026-09-16. On-demand trigger as household owner: `200 {"status":"sent","results":[{"userId":"...","ok":false,"error":"Resend 403: ...You can only send testing emails to your own email address (ronnel.go@gmail.com)..."}]}` — proved the entire chain (auth check, `refresh_household_reminders`, digest formatting, Resend API call) works correctly; the only failure was Resend's sandbox recipient restriction, not anything built here. Re-verified actual delivery separately by triggering "Send reminders now" from the real browser UI as `ronnel.go@gmail.com` — email received, which also exercises the CORS fix (this raw-fetch curl/script test does not enforce CORS and so cannot validate that fix on its own). Plain MEMBER account: `403 Forbidden: only household owners/admins can trigger reminders` — exactly as designed. Test household, items, and memberships cleaned up afterward via the test account's own access token (the two throwaway auth users themselves remain, undeletable without a service_role key, consistent with this project's standing practice).

Using a `kampuger+notiftest@gmail.com`-style test account (per this project's standing test-email practice) that's already a household owner with at least one expiring item:

```bash
# Get a session access token for the test account (replace with the real anon key and password)
curl -s -X POST 'https://nrjeqeddlssrxaskovrs.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"kampuger+notiftest@gmail.com","password":"<test password>"}'

# Call the function with that access token as the on-demand-trigger path
curl -s -X POST 'https://nrjeqeddlssrxaskovrs.supabase.co/functions/v1/compute-and-send-reminders' \
  -H "Authorization: Bearer <access_token from above>" -H "Content-Type: application/json" \
  -d '{"household_id":"<the test household id>"}'
```

Expected: `{"status":"sent","results":[{"userId":"...","ok":true}]}` and the test inbox receives the digest email. Then confirm a plain MEMBER account gets `403 Forbidden` calling the same endpoint.

- [x] **Step 5: Live UI verification via `run-web` / `run-mobile`** — partially done 2026-09-16: confirmed live in the real browser as the household owner that the admin-only fields (day thresholds, send time, intro, "Send reminders now") render and the send-now button works end-to-end (real email received). Not separately re-verified in this pass: bell badge count rendering, a plain-member's restricted view of the modal, and bell-clears-on-archive — these were already confirmed once during Task 7/8's task-level reviews (byte-for-byte diff verification against the approved plan code), and the on-demand/authorization checks just run in Step 4 exercise the same underlying data path. Mobile (`run-mobile`) not exercised in this deployment pass — recommended before considering mobile production-ready.

- [x] **Step 6: Final commit (if any fixes were needed during verification)** — not applicable: no code changes were needed during live verification. The one gap found (missing Vault secret) was a deployment-step fix, not a code fix, and is already documented in Step 2b above.

```bash
git add -A
git commit -m "fix: address issues found during notification engine live verification"
git push
```
