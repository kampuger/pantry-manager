# Household Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a household owner/admin generate a shareable, single-use invite code so a second person can join their *existing* household, either by typing the code on the "no household yet" screen or transparently on first login if they supplied the code when applying for platform access.

**Architecture:** A new `household_invites` table (RLS: owners/admins can insert and view their own household's rows, no public SELECT at all) holds codes; a `security definer` Postgres function `redeem_household_invite` does the atomic "mark used + insert membership" write so redemption is race-safe without exposing the table to direct client writes from the redeeming side. `access_applications` gains one nullable `household_invite_code` column plus a new SELECT policy so an applicant can read back their own row's code after they sign in for the first time. `useHousehold()`'s existing "no household" effect is extended to check for and auto-redeem that code before falling back to the create/join prompt; `CreateHouseholdPrompt` gains a manual `'join'` mode for everyone else.

**Tech Stack:** Supabase (Postgres + RLS + `security definer` functions), Next.js App Router (`apps/web`), the existing `@pantry/supabase-client` workspace package, Jest.

**Spec:** `docs/superpowers/specs/2026-09-18-household-invites-design.md`

## Global Constraints

- Web only — no `apps/mobile` (React Native) changes (spec Non-goals).
- No dedicated household-settings page/route — the invite-generation UI is a small addition to the existing home page, gated on the signed-in user's role in their current household (spec Non-goals).
- No list/management UI for previously-generated codes and no revoke action — an owner/admin generates a code, shares it, and it either gets used or expires; that's the whole lifecycle (spec Non-goals).
- No email delivery of invite codes — the code is a short, human-readable string the owner copies and shares out-of-band; no new email-sending mechanism (spec Non-goals).
- No cleanup job for expired/used invite rows — they stay in `household_invites` permanently, same "keep history, no DELETE policy" pattern as `access_applications` (spec Non-goals).
- No change to `access_applications`' approval/rejection logic or the existing two-call approve pattern — this plan only adds one nullable column and one new SELECT policy to that table (spec Non-goals).
- No enforcement anywhere in the database of "one household per user" — redemption is gated in the UI only (the join option only appears when `membership === null`), matching how `createHousehold` is already gated (spec Non-goals).
- Migrations require Supabase credentials this assistant does not have access to — every migration step ends with "hand off to the user," matching every prior migration task in this project.

---

### Task 1: Database migration — `household_invites` table, `redeem_household_invite` function, `access_applications` column + policy

**Files:**
- Create: `supabase/migrations/20260918000002_household_invites.sql`
- Modify: `packages/supabase-client/src/types.ts`

**Interfaces:**
- Consumes: `is_household_admin_or_owner(household_id)` (already exists, `supabase/migrations/20260913000002_rls_policies.sql:20-31`); table `households`, `household_members`, `access_applications` (already exist).
- Produces: table `household_invites(id, household_id, code, created_by, created_at, expires_at, used_at, used_by)`; function `redeem_household_invite(invite_code text) returns uuid`; column `access_applications.household_invite_code text`; policy `"applicants can read their own application"` on `access_applications`. Consumed by Tasks 2–4.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260918000002_household_invites.sql

-- =========================================================
-- HOUSEHOLD INVITES
-- A household owner/admin generates a single-use, expiring code; a new user
-- redeems it via the redeem_household_invite() function to join as a
-- MEMBER. No public SELECT policy exists on this table at all — a code is
-- only ever checked by calling the function, never by reading the table
-- directly, so one household's codes can never be enumerated from outside
-- it.
-- =========================================================
create table household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

alter table household_invites enable row level security;

create policy "owners/admins can create invites"
  on household_invites for insert
  with check (is_household_admin_or_owner(household_id));

create policy "owners/admins can view their household's invites"
  on household_invites for select
  using (is_household_admin_or_owner(household_id));

-- security definer so a brand-new user (not yet a member of anything) can
-- still write household_members on their own behalf — it only ever inserts
-- auth.uid(), so it can never be used to add anyone else. The atomic
-- `update ... where used_at is null and expires_at > now() ... returning`
-- is what makes redemption race-safe: if two people submit the same code
-- at once, only one update can affect the row — the other gets
-- v_household_id is null and the same clean error below.
create or replace function redeem_household_invite(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household_id uuid;
begin
  update household_invites
  set used_at = now(), used_by = auth.uid()
  where code = invite_code
    and used_at is null
    and expires_at > now()
  returning household_id into v_household_id;

  if v_household_id is null then
    raise exception 'This invite code is invalid, expired, or already used.';
  end if;

  insert into household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), 'MEMBER');

  return v_household_id;
end;
$$;

comment on function redeem_household_invite(text) is
  'Atomically redeems a household invite code, adding the caller as a MEMBER of the invite''s household. Returns the joined household_id.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default — restrict
-- to authenticated so an unauthenticated caller (auth.uid() null) can't
-- even attempt the insert, matching the security posture already
-- established for this project's other security definer functions.
revoke execute on function redeem_household_invite(text) from public, anon;
grant execute on function redeem_household_invite(text) to authenticated;

-- =========================================================
-- ACCESS APPLICATIONS: household invite code
-- Commemorates what the applicant typed at submission time — it is
-- nullable, unvalidated text, not a live foreign key; validity is only
-- checked at actual redemption time via redeem_household_invite(). The new
-- SELECT policy lets an applicant read their own row back (by email, from
-- their own JWT) so useHousehold()'s auto-redeem-on-first-login effect can
-- look up the code after they sign in for the first time.
-- =========================================================
alter table access_applications add column household_invite_code text;

create policy "applicants can read their own application"
  on access_applications for select
  using (email = auth.email());
```

- [ ] **Step 2: Review the file for syntax correctness**

This repo has no local Postgres/pgTAP setup, so there is no automated way to run this migration here — it is reviewed by eye, applied by the user via Supabase Studio, then verified with a live query (Task 9). Re-read the SQL above end to end and confirm: `is_household_admin_or_owner()` (referenced by both new `household_invites` policies) already exists in `supabase/migrations/20260913000002_rls_policies.sql`; `household_members` already has a unique `(household_id, user_id)` index (from the initial schema) so a caller redeeming a code for a household they already belong to gets a normal constraint-violation error, not a silent no-op; and the new `access_applications` SELECT policy's `email = auth.email()` uses only the caller's own JWT claim, never client-supplied input.

- [ ] **Step 3: Add the new table, column, and function to the hand-maintained Database type**

Open `packages/supabase-client/src/types.ts`. Inside `Tables`, add a new `household_invites` entry immediately after the existing `access_applications` entry (i.e. right before the closing `};` that ends `Tables`):

```ts
      household_invites: {
        Row: {
          id: string;
          household_id: string;
          code: string;
          created_by: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['household_invites']['Row']> & {
          household_id: string;
          code: string;
          created_by: string;
        };
        Update: Partial<Database['public']['Tables']['household_invites']['Row']>;
        Relationships: [];
      };
```

Then, in the existing `access_applications` entry, change:

```ts
      access_applications: {
        Row: {
          id: string;
          email: string;
          message: string | null;
          status: 'pending' | 'approved' | 'rejected';
          submitted_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
        };
```

to:

```ts
      access_applications: {
        Row: {
          id: string;
          email: string;
          message: string | null;
          status: 'pending' | 'approved' | 'rejected';
          submitted_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          household_invite_code: string | null;
        };
```

(`Insert`/`Update` for `access_applications` stay unchanged — both are already `Partial<Row> & { email: string }` / `Partial<Row>`, so the new nullable column is automatically optional on both.)

Finally, in `Functions`, add a new `redeem_household_invite` entry immediately after the existing `is_platform_admin` entry (i.e. right before the closing `};` that ends `Functions`):

```ts
      redeem_household_invite: {
        Args: { invite_code: string };
        Returns: string;
      };
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/supabase-client && npx tsc --noEmit`
Expected: no errors (this step only changed type declarations, no runtime code yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000002_household_invites.sql packages/supabase-client/src/types.ts
git commit -m "feat(db): add household_invites table and redeem_household_invite function"
```

- [ ] **Step 6: Flag the hand-off**

In your final report for this task, state clearly: *this migration is not yet applied to the live database* — the user needs to run it via Supabase Studio (SQL Editor, paste the file contents, run) before Task 9's live verification can happen. Tasks 2–8 do not require the live database (they're code + unit tests against a mocked client) and can proceed without waiting.

---

### Task 2: `packages/supabase-client` — `redeemHouseholdInvite`

**Files:**
- Modify: `packages/supabase-client/src/household.ts`
- Modify: `packages/supabase-client/src/household.test.ts`

**Interfaces:**
- Consumes: `Database['public']['Functions']['redeem_household_invite']` (Task 1); `HouseholdMembership` interface (already exists in this file: `{ householdId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }`).
- Produces (consumed by Task 5's `useHousehold.ts` and Task 6's `CreateHouseholdPrompt`): `redeemHouseholdInvite(client, code: string): Promise<HouseholdMembership>`.

- [ ] **Step 1: Write the failing tests**

In `packages/supabase-client/src/household.test.ts`, change the top import from:

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

to:

```ts
import {
  getMyHousehold,
  createHousehold,
  redeemHouseholdInvite,
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
} from './household';
```

Then add this new `describe` block immediately after the existing `describe('createHousehold', ...)` block and before `describe('getHouseholdNotificationPrefs', ...)`:

```ts
describe('redeemHouseholdInvite', () => {
  function fakeClient(result: { data: any; error: any }) {
    const rpc = jest.fn(async () => result);
    return { rpc } as unknown as SupabaseClient<Database> & { rpc: jest.Mock };
  }

  it('calls the redeem_household_invite RPC and returns a MEMBER membership', async () => {
    const client = fakeClient({ data: 'house-9', error: null });
    expect(await redeemHouseholdInvite(client, 'ABCD2345')).toEqual({
      householdId: 'house-9',
      role: 'MEMBER',
    });
    expect(client.rpc).toHaveBeenCalledWith('redeem_household_invite', { invite_code: 'ABCD2345' });
  });

  it('throws with the RPC error message on failure', async () => {
    const client = fakeClient({
      data: null,
      error: new Error('This invite code is invalid, expired, or already used.'),
    });
    await expect(redeemHouseholdInvite(client, 'BADCODE1')).rejects.toThrow(
      'This invite code is invalid, expired, or already used.'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest household.test.ts`
Expected: FAIL — `redeemHouseholdInvite` is not exported by `./household` (the function doesn't exist yet).

- [ ] **Step 3: Write the implementation**

In `packages/supabase-client/src/household.ts`, add this export immediately after the existing `createHousehold` function (and before the `NotificationPreferences` interface):

```ts
export async function redeemHouseholdInvite(
  client: SupabaseClient<Database>,
  code: string
): Promise<HouseholdMembership> {
  const { data, error } = await client.rpc('redeem_household_invite', { invite_code: code });
  if (error) throw error;
  return { householdId: data, role: 'MEMBER' };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest household.test.ts`
Expected: PASS, all cases green (existing `household.test.ts` cases plus the 2 new ones).

- [ ] **Step 5: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/supabase-client/src/household.ts packages/supabase-client/src/household.test.ts
git commit -m "feat(supabase-client): add redeemHouseholdInvite"
```

---

### Task 3: `packages/supabase-client` — `createHouseholdInvite`

**Files:**
- Create: `packages/supabase-client/src/householdInvites.ts`
- Test: `packages/supabase-client/src/householdInvites.test.ts`
- Modify: `packages/supabase-client/src/index.ts`

**Interfaces:**
- Consumes: `Database['public']['Tables']['household_invites']` (Task 1).
- Produces (consumed by Task 7's home-page UI): `interface HouseholdInvite { id: string; code: string; expiresAt: string }`; `createHouseholdInvite(client, householdId: string, createdBy: string): Promise<HouseholdInvite>`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/supabase-client/src/householdInvites.test.ts
import { createHouseholdInvite } from './householdInvites';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(insertResult: { data: any; error: any }) {
  const state: any = {};
  state.from = (table: string): any => {
    if (table !== 'household_invites') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => {
        state.lastInsertPayload = payload;
        return {
          select: (columns: string) => {
            state.lastSelectColumns = columns;
            return { single: async () => insertResult };
          },
        };
      },
    };
  };
  return state as SupabaseClient<Database> & { lastInsertPayload?: any; lastSelectColumns?: any };
}

const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('createHouseholdInvite', () => {
  it('inserts an 8-character code drawn from the unambiguous charset, plus household_id and created_by', async () => {
    const client = fakeClient({
      data: { id: 'inv-1', code: 'ABCD2345', expires_at: '2026-09-25T00:00:00.000Z' },
      error: null,
    });
    await createHouseholdInvite(client, 'house-1', 'user-1');
    expect(client.lastInsertPayload.household_id).toBe('house-1');
    expect(client.lastInsertPayload.created_by).toBe('user-1');
    expect(client.lastInsertPayload.code).toHaveLength(8);
    expect([...client.lastInsertPayload.code].every((c: string) => INVITE_CODE_CHARSET.includes(c))).toBe(true);
  });

  it('returns the inserted invite, mapping snake_case to camelCase', async () => {
    const client = fakeClient({
      data: { id: 'inv-1', code: 'ABCD2345', expires_at: '2026-09-25T00:00:00.000Z' },
      error: null,
    });
    expect(await createHouseholdInvite(client, 'house-1', 'user-1')).toEqual({
      id: 'inv-1',
      code: 'ABCD2345',
      expiresAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('throws when the insert errors', async () => {
    const client = fakeClient({ data: null, error: new Error('insert failed') });
    await expect(createHouseholdInvite(client, 'house-1', 'user-1')).rejects.toThrow('insert failed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest householdInvites.test.ts`
Expected: FAIL — `Cannot find module './householdInvites'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// packages/supabase-client/src/householdInvites.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface HouseholdInvite {
  id: string;
  code: string;
  expiresAt: string;
}

// Uppercase alphanumeric, excluding 0/O/1/I to avoid visual ambiguity when a
// person reads or types the code back — matches this codebase's preference
// for plain, human-typeable values over opaque identifiers wherever a
// person handles one directly.
const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARSET[Math.floor(Math.random() * INVITE_CODE_CHARSET.length)];
  }
  return code;
}

/**
 * On the (extremely unlikely) chance of a code collision against the
 * table's `unique` constraint, the insert fails and the caller sees a
 * normal "try again" error — no retry loop.
 */
export async function createHouseholdInvite(
  client: SupabaseClient<Database>,
  householdId: string,
  createdBy: string
): Promise<HouseholdInvite> {
  const { data, error } = await client
    .from('household_invites')
    .insert({ household_id: householdId, code: generateInviteCode(), created_by: createdBy })
    .select('id, code, expires_at')
    .single();

  if (error) throw error;
  return { id: data.id, code: data.code, expiresAt: data.expires_at };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest householdInvites.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Export the new module**

In `packages/supabase-client/src/index.ts`, add this line after `export * from './household';`:

```ts
export * from './householdInvites';
```

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS (existing ones untouched), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/src/householdInvites.ts packages/supabase-client/src/householdInvites.test.ts packages/supabase-client/src/index.ts
git commit -m "feat(supabase-client): add createHouseholdInvite"
```

---

### Task 4: `packages/supabase-client` — `submitApplication` invite-code param + `getMyApplicationInviteCode`

**Files:**
- Modify: `packages/supabase-client/src/accessApplications.ts`
- Modify: `packages/supabase-client/src/accessApplications.test.ts`

**Interfaces:**
- Consumes: `Database['public']['Tables']['access_applications']` including `household_invite_code` (Task 1).
- Produces (consumed by Task 5's `useHousehold.ts` and Task 8's login page): `submitApplication(client, email, message?, householdInviteCode?): Promise<void>` (signature change — one new optional 4th parameter, existing call sites passing 2 or 3 positional args are unaffected); `getMyApplicationInviteCode(client, email: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

In `packages/supabase-client/src/accessApplications.test.ts`, change the top import from:

```ts
import {
  submitApplication,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
} from './accessApplications';
```

to:

```ts
import {
  submitApplication,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
  getMyApplicationInviteCode,
} from './accessApplications';
```

Then, in the existing `describe('submitApplication', ...)` block, update the three insert-assertion tests to account for the new `household_invite_code` field always being present on the insert payload — change:

```ts
describe('submitApplication', () => {
  it('inserts email and trimmed message', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '  please let me in  ');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: 'please let me in' });
  });

  it('inserts a null message when none is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: null });
  });

  it('inserts a null message when only whitespace is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '   ');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: null });
  });
```

to:

```ts
describe('submitApplication', () => {
  it('inserts email and trimmed message', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '  please let me in  ');
    expect(client.lastInsertPayload).toEqual({
      email: 'new@example.com',
      message: 'please let me in',
      household_invite_code: null,
    });
  });

  it('inserts a null message when none is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com');
    expect(client.lastInsertPayload).toEqual({
      email: 'new@example.com',
      message: null,
      household_invite_code: null,
    });
  });

  it('inserts a null message when only whitespace is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '   ');
    expect(client.lastInsertPayload).toEqual({
      email: 'new@example.com',
      message: null,
      household_invite_code: null,
    });
  });

  it('inserts a trimmed household invite code when given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', 'msg', '  abcd2345  ');
    expect(client.lastInsertPayload.household_invite_code).toBe('abcd2345');
  });

  it('inserts a null household invite code when only whitespace is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', 'msg', '   ');
    expect(client.lastInsertPayload.household_invite_code).toBeNull();
  });
```

(Leave the two remaining tests in that `describe` block — `'resolves successfully on a duplicate-pending-email unique violation'` and `'throws on any other error'` — exactly as they are.)

Finally, add this new `describe` block at the end of the file, after the existing `describe('markApplicationRejected', ...)` block:

```ts
describe('getMyApplicationInviteCode', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'access_applications') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => result,
                }),
              }),
            }),
          }),
        }),
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('returns the invite code from the most recent approved application', async () => {
    const client = fakeClient({ data: { household_invite_code: 'ABCD2345' }, error: null });
    expect(await getMyApplicationInviteCode(client, 'a@example.com')).toBe('ABCD2345');
  });

  it('returns null when no approved application matches', async () => {
    const client = fakeClient({ data: null, error: null });
    expect(await getMyApplicationInviteCode(client, 'a@example.com')).toBeNull();
  });

  it('returns null when the matching row has no invite code', async () => {
    const client = fakeClient({ data: { household_invite_code: null }, error: null });
    expect(await getMyApplicationInviteCode(client, 'a@example.com')).toBeNull();
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getMyApplicationInviteCode(client, 'a@example.com')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest accessApplications.test.ts`
Expected: FAIL — the updated `submitApplication` assertions fail (payload is missing `household_invite_code`), and `getMyApplicationInviteCode` is not exported by `./accessApplications` yet.

- [ ] **Step 3: Write the implementation**

In `packages/supabase-client/src/accessApplications.ts`, change:

```ts
export async function submitApplication(
  client: SupabaseClient<Database>,
  email: string,
  message?: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .insert({ email, message: message?.trim() || null });
  if (error && (error as PostgrestError).code !== DUPLICATE_PENDING_APPLICATION_CODE) {
    const err = error as any;
    const thrownError = new Error(err.message);
    Object.assign(thrownError, error);
    throw thrownError;
  }
}
```

to:

```ts
export async function submitApplication(
  client: SupabaseClient<Database>,
  email: string,
  message?: string,
  householdInviteCode?: string
): Promise<void> {
  const { error } = await client.from('access_applications').insert({
    email,
    message: message?.trim() || null,
    household_invite_code: householdInviteCode?.trim() || null,
  });
  if (error && (error as PostgrestError).code !== DUPLICATE_PENDING_APPLICATION_CODE) {
    const err = error as any;
    const thrownError = new Error(err.message);
    Object.assign(thrownError, error);
    throw thrownError;
  }
}
```

Then add this export at the end of the file, after `markApplicationRejected`:

```ts
/**
 * Filters to approved applications and orders by most-recent-reviewed so a
 * user who (unusually) has more than one historical application row still
 * gets a sensible single answer. RLS independently enforces that the caller
 * can only ever see rows matching their own authenticated email, regardless
 * of what email is passed in here.
 */
export async function getMyApplicationInviteCode(
  client: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  const { data, error } = await client
    .from('access_applications')
    .select('household_invite_code')
    .eq('email', email)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.household_invite_code ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest accessApplications.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS (existing ones untouched), no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/supabase-client/src/accessApplications.ts packages/supabase-client/src/accessApplications.test.ts
git commit -m "feat(supabase-client): add household invite code to access applications"
```

---

### Task 5: `apps/web` — `useHousehold.ts` auto-redeem on first login + manual `join`

**Files:**
- Modify: `apps/web/src/lib/useHousehold.ts`

**Interfaces:**
- Consumes: `redeemHouseholdInvite` (Task 2), `getMyApplicationInviteCode` (Task 4), `getMyHousehold`/`createHousehold`/`HouseholdMembership` (already imported here).
- Produces (consumed by Task 6): `useHousehold()` now returns `{ membership, create, join }`, where `join: (code: string) => Promise<HouseholdMembership>` mirrors `create`'s existing shape.

- [ ] **Step 1: Write the implementation**

`apps/web` has no test runner configured (only `packages/*` have Jest — see the root `package.json`'s `test` script and Task 9's live-check note), so this task goes straight to implementation, matching how prior UI-only tasks in this project's plans have been handled.

Change:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMyHousehold, createHousehold, type HouseholdMembership } from '@pantry/supabase-client';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthProvider';

export function useHousehold() {
  const { session } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    getMyHousehold(supabase, session.user.id).then((result) => {
      if (!cancelled) setMembership(result);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const create = useCallback(
    async (name: string) => {
      if (!session) throw new Error('Not signed in');
      const result = await createHousehold(supabase, session.user.id, name.trim() || 'My Household');
      setMembership(result);
      return result;
    },
    [session]
  );

  return { membership, create };
}
```

to:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMyHousehold,
  createHousehold,
  redeemHouseholdInvite,
  getMyApplicationInviteCode,
  type HouseholdMembership,
} from '@pantry/supabase-client';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthProvider';

export function useHousehold() {
  const { session } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    (async () => {
      const existing = await getMyHousehold(supabase, session.user.id);
      if (existing) {
        if (!cancelled) setMembership(existing);
        return;
      }
      try {
        const code = session.user.email ? await getMyApplicationInviteCode(supabase, session.user.email) : null;
        if (code) {
          const joined = await redeemHouseholdInvite(supabase, code);
          if (!cancelled) setMembership(joined);
          return;
        }
      } catch {
        // Invalid, expired, or already-used code, or the lookup itself
        // failed — fall through to the normal create/join prompt rather
        // than blocking the user on a code they don't control, and never
        // surface this error to someone who didn't type anything
        // themselves.
      }
      if (!cancelled) setMembership(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const create = useCallback(
    async (name: string) => {
      if (!session) throw new Error('Not signed in');
      const result = await createHousehold(supabase, session.user.id, name.trim() || 'My Household');
      setMembership(result);
      return result;
    },
    [session]
  );

  const join = useCallback(
    async (code: string) => {
      if (!session) throw new Error('Not signed in');
      const result = await redeemHouseholdInvite(supabase, code);
      setMembership(result);
      return result;
    },
    [session]
  );

  return { membership, create, join };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors yet — Task 6 updates `CreateHouseholdPrompt`'s 4 call sites to destructure and pass the new `join` value; until then, `join` is simply unused by every caller, which is not a type error.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/useHousehold.ts
git commit -m "feat(web): auto-redeem a household invite code on first login"
```

---

### Task 6: `apps/web` — `CreateHouseholdPrompt` join mode + wire `join` into its 4 call sites

**Files:**
- Modify: `apps/web/src/components/CreateHouseholdPrompt.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/pantry/page.tsx`
- Modify: `apps/web/src/app/recipe/page.tsx`
- Modify: `apps/web/src/app/shopping-list/page.tsx`

**Interfaces:**
- Consumes: `join` from `useHousehold()` (Task 5).
- Produces: `CreateHouseholdPrompt` now requires an `onJoin: (code: string) => Promise<unknown>` prop alongside the existing `onCreate`. Nothing later depends on this beyond the app rendering correctly.

- [ ] **Step 1: Rewrite `CreateHouseholdPrompt.tsx`**

Change the entire file from:

```tsx
'use client';

import { useState } from 'react';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

export function CreateHouseholdPrompt({ onCreate }: { onCreate: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, marginTop: 20, maxWidth: 380, padding: 24 }}>
      <p style={{ margin: 0, color: color.foreground, fontWeight: 600 }}>Set up your household</p>
      <p style={{ margin: '4px 0 0', color: color.mutedForeground, fontSize: 13 }}>
        You&apos;re signed in, but not part of a household yet.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <label style={labelStyle}>
          Household name
          <input
            placeholder="e.g. The Santos Family"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
          {submitting ? 'Creating…' : 'Create household'}
        </button>
      </form>
    </div>
  );
}
```

to:

```tsx
'use client';

import { useState } from 'react';
import { color, cardStyle, inputStyle, buttonStyle, labelStyle } from '@/lib/theme';

type Mode = 'create' | 'join';

export function CreateHouseholdPrompt({
  onCreate,
  onJoin,
}: {
  onCreate: (name: string) => Promise<unknown>;
  onJoin: (code: string) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // Generated codes are always uppercase — trimming and uppercasing
      // here means a lowercase-typed code still matches without the user
      // needing to notice case.
      if (mode === 'join') await onJoin(code.trim().toUpperCase());
      else await onCreate(name);
    } catch (err) {
      const fallback = mode === 'join' ? 'Failed to join household' : 'Failed to create household';
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, marginTop: 20, maxWidth: 380, padding: 24 }}>
      <p style={{ margin: 0, color: color.foreground, fontWeight: 600 }}>
        {mode === 'create' ? 'Set up your household' : 'Join a household'}
      </p>
      <p style={{ margin: '4px 0 0', color: color.mutedForeground, fontSize: 13 }}>
        You&apos;re signed in, but not part of a household yet.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        {mode === 'create' ? (
          <label style={labelStyle}>
            Household name
            <input
              placeholder="e.g. The Santos Family"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </label>
        ) : (
          <label style={labelStyle}>
            Invite code
            <input
              placeholder="e.g. AB3DEFGH"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}
        {error && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={submitting} style={buttonStyle('primary')}>
          {submitting
            ? mode === 'create'
              ? 'Creating…'
              : 'Joining…'
            : mode === 'create'
              ? 'Create household'
              : 'Join household'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => switchMode(mode === 'create' ? 'join' : 'create')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginTop: 12,
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 600,
          color: color.primary,
        }}
      >
        {mode === 'create' ? 'Have an invite code instead?' : 'Create a new household instead'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire `join` into the home page**

In `apps/web/src/app/page.tsx`, change:

```tsx
  const { membership, create } = useHousehold();
```

to:

```tsx
  const { membership, create, join } = useHousehold();
```

And change:

```tsx
        <CreateHouseholdPrompt onCreate={create} />
```

to:

```tsx
        <CreateHouseholdPrompt onCreate={create} onJoin={join} />
```

- [ ] **Step 3: Wire `join` into the pantry page**

In `apps/web/src/app/pantry/page.tsx`, change:

```tsx
  const { membership, create } = useHousehold();
```

to:

```tsx
  const { membership, create, join } = useHousehold();
```

And change:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
```

to:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} onJoin={join} />}
```

- [ ] **Step 4: Wire `join` into the recipe page**

In `apps/web/src/app/recipe/page.tsx`, change:

```tsx
  const { membership, create } = useHousehold();
```

to:

```tsx
  const { membership, create, join } = useHousehold();
```

And change:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
```

to:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} onJoin={join} />}
```

- [ ] **Step 5: Wire `join` into the shopping-list page**

In `apps/web/src/app/shopping-list/page.tsx`, change:

```tsx
  const { membership, create } = useHousehold();
```

to:

```tsx
  const { membership, create, join } = useHousehold();
```

And change:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
```

to:

```tsx
      {membership === null && <CreateHouseholdPrompt onCreate={create} onJoin={join} />}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If any is missed, TypeScript will report `Property 'onJoin' is missing` at that `<CreateHouseholdPrompt>` call site — a complete list of the 4 call sites is given in this task's Files section.)

- [ ] **Step 7: Run the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/CreateHouseholdPrompt.tsx apps/web/src/app/page.tsx apps/web/src/app/pantry/page.tsx apps/web/src/app/recipe/page.tsx apps/web/src/app/shopping-list/page.tsx
git commit -m "feat(web): add a join-by-code mode to CreateHouseholdPrompt"
```

---

### Task 7: `apps/web` — home page: generate an invite code

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: `createHouseholdInvite`, `type HouseholdInvite` (Task 3); `membership`, `session`, `supabase` (already in scope on this page).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the new import**

In `apps/web/src/app/page.tsx`, change:

```tsx
import { getHouseholdNotificationPrefs, STORAGE_LOCATION_OPTIONS, type Database } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, cardStyle, buttonStyle } from '@/lib/theme';
```

to:

```tsx
import {
  getHouseholdNotificationPrefs,
  createHouseholdInvite,
  STORAGE_LOCATION_OPTIONS,
  type Database,
  type HouseholdInvite,
} from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';
import { color, radius, cardStyle, buttonStyle } from '@/lib/theme';
```

- [ ] **Step 2: Add a local expiry-date formatter**

Immediately after the existing `shortUtcDate` function (and before `buildBucketLabels`), add:

```tsx
function formatInviteExpiry(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
```

- [ ] **Step 3: Add invite-panel state**

Immediately after the existing `const [loadError, setLoadError] = useState<string | null>(null);` line, add:

```tsx
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState<HouseholdInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
```

- [ ] **Step 4: Add the invite handlers and role check, and rewrite `header`**

Change:

```tsx
  const header = (
    <header>
      <p style={{ margin: 0, color: color.mutedForeground, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        Overview
      </p>
      <h1 style={{ margin: '6px 0 0' }}>Dashboard</h1>
    </header>
  );
```

to:

```tsx
  const canInvite =
    membership !== null && membership !== 'loading' && (membership.role === 'OWNER' || membership.role === 'ADMIN');

  async function handleGenerateInvite() {
    if (!session || membership === null || membership === 'loading') return;
    setGeneratingInvite(true);
    setInviteError(null);
    setCopied(false);
    try {
      setInvite(await createHouseholdInvite(supabase, membership.householdId, session.user.id));
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to generate invite code');
    } finally {
      setGeneratingInvite(false);
    }
  }

  async function handleCopyInviteCode() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
    } catch {
      // Clipboard access can be denied by the browser — the code stays
      // visible in the box below for the owner to select and copy by hand.
    }
  }

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
      <div>
        <p style={{ margin: 0, color: color.mutedForeground, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Overview
        </p>
        <h1 style={{ margin: '6px 0 0' }}>Dashboard</h1>
      </div>

      {canInvite && (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <button onClick={() => setInviteOpen((v) => !v)} style={buttonStyle('secondary')}>
            Invite a member
          </button>
          {inviteOpen && (
            <div style={{ ...cardStyle, padding: 16, display: 'grid', gap: 10, minWidth: 260 }}>
              {inviteError && <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{inviteError}</p>}
              {invite ? (
                <>
                  <div
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 18,
                      fontWeight: 700,
                      letterSpacing: 2,
                      padding: '8px 12px',
                      borderRadius: radius.sm,
                      background: color.muted,
                      textAlign: 'center',
                    }}
                  >
                    {invite.code}
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: color.mutedForeground, textAlign: 'center' }}>
                    Expires {formatInviteExpiry(invite.expiresAt)}
                  </p>
                  <button onClick={handleCopyInviteCode} style={buttonStyle('secondary')}>
                    {copied ? 'Copied!' : 'Copy code'}
                  </button>
                </>
              ) : (
                <button onClick={handleGenerateInvite} disabled={generatingInvite} style={buttonStyle('primary')}>
                  {generatingInvite ? 'Generating…' : 'Generate code'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
```

(`canInvite` only ever evaluates true once `membership` is a real `HouseholdMembership` — in the "no household yet" branch below, `membership === null`, so `header` renders with `canInvite` false and no invite UI, exactly as intended.)

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Run the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): generate a household invite code from the dashboard header"
```

---

### Task 8: `apps/web` — login page: optional invite code on the apply form

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `submitApplication`'s new 4th parameter (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add invite-code state**

Change:

```tsx
  const [message, setMessage] = useState('');
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
```

to:

```tsx
  const [message, setMessage] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
```

- [ ] **Step 2: Reset it in `switchMode`**

Change:

```tsx
  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setStatusIsError(false);
    setApplicationSubmitted(false);
    setMessage('');
  }
```

to:

```tsx
  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setStatusIsError(false);
    setApplicationSubmitted(false);
    setMessage('');
    setInviteCode('');
  }
```

- [ ] **Step 3: Pass it through on submit**

Change:

```tsx
    if (mode === 'apply') {
      try {
        await submitApplication(supabase, email.trim(), message);
        setApplicationSubmitted(true);
```

to:

```tsx
    if (mode === 'apply') {
      try {
        await submitApplication(supabase, email.trim(), message, inviteCode);
        setApplicationSubmitted(true);
```

- [ ] **Step 4: Add the field to the apply form**

Change:

```tsx
              {mode === 'apply' && (
                <div>
                  <label
                    htmlFor="message"
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: color.mutedForeground, marginBottom: 6 }}
                  >
                    Anything you&apos;d like us to know? (optional)
                  </label>
                  <textarea
                    id="message"
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '13px 14px',
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderStyle: 'solid',
                      borderColor: color.border,
                      fontFamily: 'inherit',
                      fontSize: 14,
                      background: color.card,
                      color: color.foreground,
                      outline: 'none',
                      resize: 'vertical',
                    }}
                  />
                </div>
              )}
```

to:

```tsx
              {mode === 'apply' && (
                <div>
                  <label
                    htmlFor="message"
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: color.mutedForeground, marginBottom: 6 }}
                  >
                    Anything you&apos;d like us to know? (optional)
                  </label>
                  <textarea
                    id="message"
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '13px 14px',
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderStyle: 'solid',
                      borderColor: color.border,
                      fontFamily: 'inherit',
                      fontSize: 14,
                      background: color.card,
                      color: color.foreground,
                      outline: 'none',
                      resize: 'vertical',
                    }}
                  />
                </div>
              )}

              {mode === 'apply' && (
                <div>
                  <label
                    htmlFor="inviteCode"
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, color: color.mutedForeground, marginBottom: 6 }}
                  >
                    Household invite code (optional)
                  </label>
                  <input
                    id="inviteCode"
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '13px 14px',
                      borderRadius: radius.md,
                      borderWidth: 1.5,
                      borderStyle: 'solid',
                      borderColor: color.border,
                      fontFamily: 'inherit',
                      fontSize: 14,
                      background: color.card,
                      color: color.foreground,
                      outline: 'none',
                    }}
                  />
                </div>
              )}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Run the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/login/page.tsx
git commit -m "feat(web): accept an optional household invite code on the apply form"
```

---

### Task 9: Live verification (after the user applies Task 1's migration)

**Files:** none — verification only, no code changes expected unless a live-only bug surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–8, live.

- [ ] **Step 1: Confirm the migration landed and verify RLS directly**

Ask the user to confirm they've run `supabase/migrations/20260918000002_household_invites.sql` via Supabase Studio. Then verify directly:

```sql
select id, household_id, code, expires_at, used_at from household_invites;
```

Expected: query succeeds (table exists), returns zero rows on a fresh apply.

Then verify the RLS policies themselves (via Supabase Studio's SQL editor run as different roles, or `curl` against the REST endpoint with the anon key):
1. A non-owner/non-admin household member cannot `insert` into `household_invites`.
2. A user cannot `select` another household's invite rows.
3. An applicant can `select` their own `access_applications` row by email (now including `household_invite_code`) but not anyone else's.
4. Calling `redeem_household_invite('nonexistent-code')` as any authenticated user raises `'This invite code is invalid, expired, or already used.'` rather than a raw database error.

- [ ] **Step 2: Live check of manual code generation and redemption**

Using the `run-web` pattern established in this project:
1. As an existing household owner, open the dashboard, click "Invite a member," click "Generate code," and confirm a code plus an expiry date roughly 7 days out is displayed, and "Copy code" works.
2. As a second, fresh throwaway account with no household, go to `/`, confirm the "no household yet" prompt appears, click "Have an invite code instead?", type the generated code (try it lowercase to confirm the uppercase-normalization), submit, and confirm the account lands in the same household as a `MEMBER` (check `household_members` directly if needed).
3. Attempt to redeem the same code again with a third throwaway account and confirm the clear "invalid, expired, or already used" error is shown inline, not a raw database error.
4. Confirm a plain `MEMBER` (not owner/admin) does not see the "Invite a member" button on the dashboard at all.

- [ ] **Step 3: Live check of the auto-redeem-on-approval flow**

1. As an existing household owner, generate a fresh invite code.
2. Go to `/login`, switch to "Apply for access," fill in a fresh throwaway email and the invite code from step 1, and submit.
3. Ask the user to sign in as `ronnel.go@gmail.com` (an existing platform admin) and approve that application from `/admin/users`.
4. Sign in as the newly-invited throwaway account for the first time and confirm they land directly in the inviting household with no create/join prompt shown at all — no household name, no invite-code entry, nothing to click.

- [ ] **Step 4: Live check of the fallback case**

Submit a fresh application with **no** invite code attached, have it approved, and sign in as that account for the first time — confirm the normal create/join prompt appears (auto-redeem correctly finds no code and falls through).

- [ ] **Step 5: Report results**

Summarize what passed, what (if anything) needed a live-only fix, and confirm the feature is ready to use.
