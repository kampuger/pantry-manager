# Platform Admin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin invite users, suspend/unsuspend any account, and grant/revoke admin rights to other users, from a new `/admin/users` web page.

**Architecture:** A new `platform_admins` table (RLS-gated, separate from the existing per-household `OWNER`/`ADMIN`/`MEMBER` roles) marks who is a platform admin. A new `admin-manage-users` Edge Function — the only code path that touches Supabase's service-role-only Auth Admin API — handles listing all users, inviting, and suspending/unsuspending; promoting/demoting an admin is a direct, RLS-gated table write instead, since it needs no privileged API. `packages/supabase-client` wraps both. The web page renders a table (or, on a narrow viewport, stacked cards) driven entirely by those wrappers; the desktop Sidebar and mobile hamburger menu each independently check admin status to decide whether to show an "Admin" link.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno), Next.js App Router (`apps/web`), the existing `@pantry/supabase-client` workspace package, Jest.

**Spec:** `docs/superpowers/specs/2026-09-16-platform-admin-user-management-design.md`

## Global Constraints

- Web only — no `apps/mobile` (React Native) changes in this plan (spec Non-goals).
- No password-based account creation — "add user" only ever sends an invite email (spec Non-goals).
- No changes to `household_members` or its existing RLS policies — platform admin is a fully separate privilege axis (spec Non-goals).
- The Edge Function reuses the already-configured `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` secrets — no new secrets to request from the user.
- Migrations and Edge Function deploys require Supabase credentials this assistant does not have access to (per this project's standing rule) — every such step ends with "hand off to the user," matching every prior migration/Edge-Function task this session.
- The seed admin is `ronnel.go@gmail.com` (spec Bootstrap).
- Ban duration for "suspend" is `'876000h'` (~100 years — Supabase has no literal "forever"); unsuspend sets it back to `'none'` (spec Edge Function).

---

### Task 1: Database migration — `platform_admins` table, RLS, guards, seed

**Files:**
- Create: `supabase/migrations/20260916000004_platform_admin_users.sql`
- Modify: `packages/supabase-client/src/types.ts` (add the `platform_admins` table type and the `is_platform_admin` function type)

**Interfaces:**
- Produces: table `platform_admins(user_id uuid primary key, granted_by uuid, granted_at timestamptz)`; SQL function `is_platform_admin() returns boolean` (callable both from RLS policies and as a client RPC); trigger that blocks deleting the last remaining admin row.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260916000004_platform_admin_users.sql

-- =========================================================
-- PLATFORM ADMINS
-- A separate privilege axis from household_members.role — being a platform
-- admin has nothing to do with owning/administering any particular
-- household. Existence of a row IS admin status; there is no boolean flag
-- to flip.
-- =========================================================
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

create or replace function is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

comment on function is_platform_admin is
  'Whether the calling user is a platform admin. security definer so it can read platform_admins regardless of RLS — same pattern as is_household_member(). Callable directly as an RPC (client-side "am I admin" checks) and from other RLS policies.';

create policy "admins can read the admin list"
  on platform_admins for select
  using (is_platform_admin());

create policy "admins can promote other users"
  on platform_admins for insert
  with check (is_platform_admin());

create policy "admins can demote other admins"
  on platform_admins for delete
  using (is_platform_admin());

-- Prevents the panel from ever locking everyone out by demoting the last
-- admin (including demoting themselves, if they're the only one left).
create or replace function prevent_removing_last_admin()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from platform_admins) <= 1 then
    raise exception 'cannot remove the last remaining platform admin';
  end if;
  return old;
end;
$$;

create trigger trg_prevent_removing_last_admin
  before delete on platform_admins
  for each row
  execute function prevent_removing_last_admin();

-- Seed the first admin. `on conflict do nothing` makes this safe to leave
-- in the migration permanently (re-running it is a no-op, not an error).
insert into platform_admins (user_id, granted_by)
select id, id from auth.users where email = 'ronnel.go@gmail.com'
on conflict (user_id) do nothing;
```

- [ ] **Step 2: Review the file for syntax correctness**

This repo has no local Postgres/pgTAP setup, so there is no automated way to run this migration here — every migration this session has been reviewed by eye, applied by the user via Supabase Studio, then verified with a live query. Re-read the SQL above end to end and confirm: every `create policy` references a table that exists above it, `is_platform_admin()` is defined before any policy uses it, and the trigger function's `security definer` + `set search_path` match the existing `prevent_self_household_member_escalation` pattern in `supabase/migrations/20260916000001_notification_reminders_schema.sql`.

- [ ] **Step 3: Add the new table and function to the hand-maintained Database type**

Open `packages/supabase-client/src/types.ts`. Inside `Tables`, add a new entry (alongside the existing `households`, `household_members`, etc. — insert it after `grocery_list_entries`, before the closing brace of `Tables`):

```ts
      platform_admins: {
        Row: {
          user_id: string;
          granted_by: string | null;
          granted_at: string;
        };
        Insert: Partial<Database['public']['Tables']['platform_admins']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['platform_admins']['Row']>;
        Relationships: [];
      };
```

Inside `Functions` (alongside the existing `archive_pantry_item` entry), add:

```ts
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p packages/supabase-client/tsconfig.json`
Expected: no errors (this step only changed type declarations, no runtime code yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916000004_platform_admin_users.sql packages/supabase-client/src/types.ts
git commit -m "feat(db): add platform_admins table, RLS, and last-admin guard"
```

- [ ] **Step 6: Flag the hand-off**

In your final report for this task, state clearly: *this migration is not yet applied to the live database* — the user needs to run it via Supabase Studio (SQL Editor, paste the file contents, run) before Task 6's live verification can happen. Tasks 2–5 do not require the live database (they're code + unit tests against a mocked client) and can proceed without waiting.

---

### Task 2: `packages/supabase-client` — platform admin API wrappers

**Files:**
- Create: `packages/supabase-client/src/platformAdmin.ts`
- Test: `packages/supabase-client/src/platformAdmin.test.ts`
- Modify: `packages/supabase-client/src/index.ts` (add `export * from './platformAdmin';`)

**Interfaces:**
- Consumes: `Database` type from `./types` (produced by Task 1); table `platform_admins` (`user_id`, `granted_by`, `granted_at`); RPC `is_platform_admin`; Edge Function name `'admin-manage-users'` (deployed in Task 3, but not required to exist for these unit tests — they mock `client.functions.invoke`).
- Produces (consumed by Task 4's page and Task 5's nav):
  - `interface AdminUserRow { id: string; email: string | null; createdAt: string; bannedUntil: string | null; isAdmin: boolean; }`
  - `checkIsPlatformAdmin(client): Promise<boolean>`
  - `listAllUsers(client): Promise<AdminUserRow[]>`
  - `inviteUser(client, email: string): Promise<void>`
  - `suspendUser(client, targetUserId: string): Promise<void>`
  - `unsuspendUser(client, targetUserId: string): Promise<void>`
  - `grantAdmin(client, targetUserId: string, grantedBy: string): Promise<void>`
  - `revokeAdmin(client, targetUserId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/supabase-client/src/platformAdmin.test.ts
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
} from './platformAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

describe('checkIsPlatformAdmin', () => {
  it('returns true when the RPC reports the caller is an admin', async () => {
    const rpc = jest.fn(async () => ({ data: true, error: null }));
    const client = { rpc } as unknown as SupabaseClient<Database>;

    expect(await checkIsPlatformAdmin(client)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_platform_admin', {});
  });

  it('returns false when the RPC reports the caller is not an admin', async () => {
    const client = { rpc: jest.fn(async () => ({ data: false, error: null })) } as unknown as SupabaseClient<Database>;
    expect(await checkIsPlatformAdmin(client)).toBe(false);
  });

  it('throws when the RPC errors', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: new Error('boom') })) } as unknown as SupabaseClient<Database>;
    await expect(checkIsPlatformAdmin(client)).rejects.toThrow('boom');
  });
});

describe('listAllUsers', () => {
  it('invokes admin-manage-users with the list_users action and returns the users array', async () => {
    const users = [{ id: 'u1', email: 'a@example.com', createdAt: '2026-09-01', bannedUntil: null, isAdmin: true }];
    const invoke = jest.fn(async () => ({ data: { status: 'ok', users }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    expect(await listAllUsers(client)).toEqual(users);
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', { body: { action: 'list_users' } });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('403 Forbidden') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(listAllUsers(client)).rejects.toThrow('403 Forbidden');
  });
});

describe('inviteUser', () => {
  it('invokes admin-manage-users with the invite_user action and email', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await inviteUser(client, 'new@example.com');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'invite_user', email: 'new@example.com' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('already registered') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(inviteUser(client, 'dup@example.com')).rejects.toThrow('already registered');
  });
});

describe('suspendUser / unsuspendUser', () => {
  it('invokes admin-manage-users with suspend_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await suspendUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'suspend_user', targetUserId: 'user-2' },
    });
  });

  it('invokes admin-manage-users with unsuspend_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await unsuspendUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'unsuspend_user', targetUserId: 'user-2' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('cannot suspend your own account') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(suspendUser(client, 'self-id')).rejects.toThrow('cannot suspend your own account');
  });
});

describe('grantAdmin / revokeAdmin', () => {
  function fakeClient(handlers: { insertResult?: { error: any }; deleteResult?: { error: any } }) {
    const state: any = {};
    state.from = (table: string): any => {
      if (table !== 'platform_admins') throw new Error(`Unexpected table: ${table}`);
      return {
        insert: (payload: any) => {
          state.lastInsertPayload = payload;
          return Promise.resolve(handlers.insertResult);
        },
        delete: () => ({
          eq: (...args: any[]) => {
            state.lastEqArgs = args;
            return Promise.resolve(handlers.deleteResult);
          },
        }),
      };
    };
    return state as SupabaseClient<Database> & { lastInsertPayload?: any; lastEqArgs?: any[] };
  }

  it('grantAdmin inserts a row with user_id and granted_by', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await grantAdmin(client, 'user-2', 'admin-1');
    expect(client.lastInsertPayload).toEqual({ user_id: 'user-2', granted_by: 'admin-1' });
  });

  it('grantAdmin throws when the insert errors', async () => {
    const client = fakeClient({ insertResult: { error: new Error('insert failed') } });
    await expect(grantAdmin(client, 'user-2', 'admin-1')).rejects.toThrow('insert failed');
  });

  it('revokeAdmin deletes by user_id', async () => {
    const client = fakeClient({ deleteResult: { error: null } });
    await revokeAdmin(client, 'user-2');
    expect(client.lastEqArgs).toEqual(['user_id', 'user-2']);
  });

  it('revokeAdmin throws when the delete errors', async () => {
    const client = fakeClient({ deleteResult: { error: new Error('cannot remove the last remaining platform admin') } });
    await expect(revokeAdmin(client, 'user-2')).rejects.toThrow('cannot remove the last remaining platform admin');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest platformAdmin.test.ts`
Expected: FAIL — `Cannot find module './platformAdmin'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// packages/supabase-client/src/platformAdmin.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  /** null/past = active, future = suspended — matches Supabase Auth's own `banned_until` field directly rather than inventing a separate status enum. */
  bannedUntil: string | null;
  isAdmin: boolean;
}

/** Whether the signed-in caller is a platform admin. Drives both the /admin/users access check and the conditional "Admin" nav link. */
export async function checkIsPlatformAdmin(client: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await client.rpc('is_platform_admin', {});
  if (error) throw error;
  return !!data;
}

/**
 * All of the above go through the `admin-manage-users` Edge Function
 * because they need Supabase's Auth Admin API, which only works with the
 * service_role key — never available in the browser. The function itself
 * re-checks the caller is a platform admin server-side; it isn't trusted
 * client-side alone.
 */
export async function listAllUsers(client: SupabaseClient<Database>): Promise<AdminUserRow[]> {
  const { data, error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'list_users' },
  });
  if (error) throw error;
  return data.users;
}

export async function inviteUser(client: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'invite_user', email },
  });
  if (error) throw error;
}

export async function suspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'suspend_user', targetUserId },
  });
  if (error) throw error;
}

export async function unsuspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'unsuspend_user', targetUserId },
  });
  if (error) throw error;
}

/**
 * Unlike suspend/invite/list, granting or revoking admin needs no Auth
 * Admin API access — it's a plain write to `platform_admins`, gated by
 * that table's own RLS policies (only an existing admin may write to it).
 */
export async function grantAdmin(
  client: SupabaseClient<Database>,
  targetUserId: string,
  grantedBy: string
): Promise<void> {
  const { error } = await client.from('platform_admins').insert({ user_id: targetUserId, granted_by: grantedBy });
  if (error) throw error;
}

export async function revokeAdmin(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.from('platform_admins').delete().eq('user_id', targetUserId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest platformAdmin.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Export the new module**

In `packages/supabase-client/src/index.ts`, add one line (matching the existing alphabetical-ish grouping — after `./pantry`, before `./groceryList` is fine, exact position doesn't matter since these are all flat re-exports):

```ts
export * from './platformAdmin';
```

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS (existing ones untouched), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/src/platformAdmin.ts packages/supabase-client/src/platformAdmin.test.ts packages/supabase-client/src/index.ts
git commit -m "feat(supabase-client): add platform admin API wrappers"
```

---

### Task 3: Edge Function — `admin-manage-users`

**Files:**
- Create: `supabase/functions/admin-manage-users/index.ts`

**Interfaces:**
- Consumes: table `platform_admins` (Task 1); request shape `{ action: 'list_users' | 'invite_user' | 'suspend_user' | 'unsuspend_user', email?: string, targetUserId?: string }` (matches what Task 2's wrappers send).
- Produces: JSON responses `{ status: 'ok', users?: AdminUserRow[] }` (200) or `{ status: 'error', message: string }` (4xx/5xx) — `users` entries use the exact same field names as Task 2's `AdminUserRow` (`id`, `email`, `createdAt`, `bannedUntil`, `isAdmin`) so the client needs no field-renaming.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/admin-manage-users/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Supabase's ban mechanism has no literal "forever" — this is the
// established convention for an effectively permanent suspension.
// Unsuspending sets the duration back to 'none'.
const PERMANENT_BAN_DURATION = '876000h';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface RequestBody {
  action?: string;
  email?: string;
  targetUserId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice('Bearer '.length);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every caller of this function is an end user's own browser session —
  // unlike compute-and-send-reminders, there is no service_role/pg_cron
  // calling path here, so a bare bearer-token check is sufficient.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
  }
  const callerId = userData.user.id;

  const { data: adminRow } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle();
  if (!adminRow) {
    return jsonResponse({ status: 'error', message: 'Forbidden: platform admin access required' }, 403);
  }

  const { action } = body;

  if (action === 'list_users') {
    const perPage = 200;
    let page = 1;
    const allUsers: Array<{ id: string; email?: string; created_at: string; banned_until?: string }> = [];
    // deno-lint-ignore no-constant-condition
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ status: 'error', message: error.message }, 500);
      allUsers.push(...data.users);
      if (data.users.length < perPage) break;
      page += 1;
    }

    const { data: adminRows, error: adminRowsError } = await admin.from('platform_admins').select('user_id');
    if (adminRowsError) return jsonResponse({ status: 'error', message: adminRowsError.message }, 500);
    const adminIds = new Set((adminRows ?? []).map((r) => r.user_id));

    const users = allUsers.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at,
      bannedUntil: u.banned_until ?? null,
      isAdmin: adminIds.has(u.id),
    }));

    return jsonResponse({ status: 'ok', users });
  }

  if (action === 'invite_user') {
    const email = body.email;
    if (!email || !email.includes('@')) {
      return jsonResponse({ status: 'error', message: 'A valid email is required' }, 400);
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) return jsonResponse({ status: 'error', message: error.message }, 400);
    return jsonResponse({ status: 'ok' });
  }

  if (action === 'suspend_user' || action === 'unsuspend_user') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) {
      return jsonResponse({ status: 'error', message: 'targetUserId is required' }, 400);
    }
    if (targetUserId === callerId) {
      return jsonResponse({ status: 'error', message: 'Cannot suspend your own account' }, 400);
    }
    const banDuration = action === 'suspend_user' ? PERMANENT_BAN_DURATION : 'none';
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: banDuration });
    if (error) return jsonResponse({ status: 'error', message: error.message }, 400);
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ status: 'error', message: `Unknown action: ${action}` }, 400);
});
```

- [ ] **Step 2: Review against the existing Edge Function for consistency**

Open `supabase/functions/compute-and-send-reminders/index.ts` side by side. Confirm: CORS headers are byte-for-byte identical, the `Deno.serve` structure (OPTIONS short-circuit, method check, JSON body parse in a try/catch) matches, and the admin client is created the same way (`createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` from the `npm:@supabase/supabase-js@2` specifier).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-manage-users/index.ts
git commit -m "feat(functions): add admin-manage-users Edge Function"
```

- [ ] **Step 4: Flag the hand-off**

State clearly in your report: this function is not yet deployed. The user needs to run `supabase functions deploy admin-manage-users` (or deploy via the Supabase dashboard) themselves — this assistant has no CLI-deploy credentials for this project. Task 6's live verification needs both this deploy and Task 1's migration applied first.

---

### Task 4: Web page — `/admin/users`

**Files:**
- Create: `apps/web/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `checkIsPlatformAdmin`, `listAllUsers`, `inviteUser`, `suspendUser`, `unsuspendUser`, `grantAdmin`, `revokeAdmin`, `type AdminUserRow` (all from Task 2, imported from `@pantry/supabase-client`); `supabase` client singleton from `@/lib/supabaseClient`; `useAuth` from `@/lib/AuthProvider`; `useIsMobile` from `@/lib/useIsMobile`; `color`, `cardStyle`, `inputStyle`, `buttonStyle`, `badgeStyle` from `@/lib/theme` (all pre-existing).
- Produces: nothing consumed by later tasks (Task 5 only links to this route by path string, `/admin/users`).

- [ ] **Step 1: Write the page**

```tsx
// apps/web/src/app/admin/users/page.tsx
'use client';

import { useEffect, useState } from 'react';
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
  type AdminUserRow,
} from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useIsMobile } from '@/lib/useIsMobile';
import { color, cardStyle, inputStyle, buttonStyle, badgeStyle, labelStyle } from '@/lib/theme';

function isSuspended(user: AdminUserRow): boolean {
  return !!user.bannedUntil && new Date(user.bannedUntil).getTime() > Date.now();
}

function formatJoined(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminUsersPage() {
  const { session, loading: authLoading } = useAuth();
  const isMobile = useIsMobile();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteIsError, setInviteIsError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  function refreshUsers() {
    listAllUsers(supabase)
      .then(setUsers)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load users'));
  }

  useEffect(() => {
    if (!session) {
      setCheckingAccess(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) refreshUsers();
      })
      .finally(() => setCheckingAccess(false));
  }, [session]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteStatus(null);
    setInviteIsError(false);
    try {
      await inviteUser(supabase, email.trim());
      setInviteStatus(`Invite sent to ${email.trim()}`);
      setEmail('');
      refreshUsers();
    } catch (err) {
      setInviteIsError(true);
      setInviteStatus(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  }

  async function handleToggleSuspend(user: AdminUserRow) {
    setBusyUserId(user.id);
    setActionError(null);
    try {
      if (isSuspended(user)) await unsuspendUser(supabase, user.id);
      else await suspendUser(supabase, user.id);
      refreshUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleToggleAdmin(user: AdminUserRow) {
    if (!session) return;
    setBusyUserId(user.id);
    setActionError(null);
    try {
      if (user.isAdmin) await revokeAdmin(supabase, user.id);
      else await grantAdmin(supabase, user.id, session.user.id);
      refreshUsers();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyUserId(null);
    }
  }

  if (authLoading || checkingAccess) return null;

  if (!session) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          <a href="/login" style={{ color: color.primary, fontWeight: 600 }}>
            Sign in
          </a>{' '}
          to continue.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Admin</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <header>
        <h1 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.02em' }}>Manage users</h1>
        <p style={{ color: color.mutedForeground, marginTop: 8, fontSize: 14 }}>
          Invite new users, suspend accounts, and grant or remove admin access.
        </p>
      </header>

      <form
        onSubmit={handleInvite}
        style={{ ...cardStyle, padding: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ ...labelStyle, flex: '1 1 240px' }}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            style={inputStyle}
          />
        </label>
        <button type="submit" disabled={inviting} style={buttonStyle('primary')}>
          {inviting ? 'Sending…' : 'Send invite'}
        </button>
        {inviteStatus && (
          <p style={{ width: '100%', margin: 0, fontSize: 13, color: inviteIsError ? color.destructive : color.success }}>
            {inviteStatus}
          </p>
        )}
      </form>

      {loadError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{loadError}</p>}
      {actionError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{actionError}</p>}

      {isMobile ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {users.map((user) => {
            const suspended = isSuspended(user);
            const isSelf = user.id === session.user.id;
            return (
              <div key={user.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                  {user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}
                </div>
                <div style={{ fontSize: 12, color: color.mutedForeground }}>Joined {formatJoined(user.createdAt)}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleToggleSuspend(user)} disabled={busyUserId === user.id} style={buttonStyle('secondary')}>
                    {suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button
                    onClick={() => handleToggleAdmin(user)}
                    disabled={busyUserId === user.id || isSelf}
                    title={isSelf ? "You can't remove your own admin access from here" : undefined}
                    style={buttonStyle('secondary')}
                  >
                    {user.isAdmin ? 'Remove admin' : 'Make admin'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 20, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Email</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Admin</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Joined</th>
                <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }} />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const suspended = isSuspended(user);
                const isSelf = user.id === session.user.id;
                return (
                  <tr key={user.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                    </td>
                    <td style={{ padding: '10px' }}>{user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(user.createdAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => handleToggleSuspend(user)} disabled={busyUserId === user.id} style={buttonStyle('secondary')}>
                          {suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button
                          onClick={() => handleToggleAdmin(user)}
                          disabled={busyUserId === user.id || isSelf}
                          title={isSelf ? "You can't remove your own admin access from here" : undefined}
                          style={buttonStyle('secondary')}
                        >
                          {user.isAdmin ? 'Remove admin' : 'Make admin'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors. (If `AdminUserRow`/the new functions aren't found, re-check Task 2's `index.ts` export landed.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/users/page.tsx
git commit -m "feat(web): add /admin/users page"
```

---

### Task 5: Nav integration — conditional "Admin" link

**Files:**
- Modify: `apps/web/src/components/navItems.tsx` (add an exported `IconAdmin` icon — not added to the `NAV_ITEMS` array, which stays exactly as-is per the spec)
- Modify: `apps/web/src/components/Sidebar.tsx`
- Modify: `apps/web/src/components/MobileNav.tsx`

**Interfaces:**
- Consumes: `checkIsPlatformAdmin` from `@pantry/supabase-client` (Task 2); `supabase` from `@/lib/supabaseClient`; route path `/admin/users` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the shared admin icon**

In `apps/web/src/components/navItems.tsx`, add this function anywhere alongside the other `Icon*` functions (e.g. right after `IconFinancial`), and export it — do **not** add an entry to `NAV_ITEMS`:

```tsx
export function IconAdmin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6l7-3z" />
      <path d="M9.5 12l2 2 3.5-4" />
    </svg>
  );
}
```

- [ ] **Step 2: Add the admin check + conditional link to Sidebar.tsx**

In `apps/web/src/components/Sidebar.tsx`:

Change the import line

```tsx
import { NAV_ITEMS } from './navItems';
```

to

```tsx
import { NAV_ITEMS, IconAdmin } from './navItems';
```

and add these two imports above it:

```tsx
import { useEffect, useState } from 'react';
import { checkIsPlatformAdmin } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
```

Inside `export function Sidebar() {`, right after the existing `const router = useRouter();` line, add:

```tsx
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [session]);
```

Immediately after the closing `})}` of the existing `{NAV_ITEMS.map((item) => { ... })}` block (still inside the same `<div>` that wraps the brand row and nav items), add:

```tsx
        {isAdmin && (
          <Link
            href="/admin/users"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: radius.sm,
              fontSize: 14,
              fontWeight: pathname === '/admin/users' ? 600 : 500,
              textDecoration: 'none',
              color: pathname === '/admin/users' ? color.primary : color.mutedForeground,
              background: pathname === '/admin/users' ? color.muted : 'transparent',
              transition: 'background 150ms ease, color 150ms ease',
            }}
          >
            <IconAdmin />
            Admin
          </Link>
        )}
```

- [ ] **Step 3: Add the same check + link to MobileNav.tsx**

In `apps/web/src/components/MobileNav.tsx`:

Add these two imports (alongside the existing ones):

```tsx
import { checkIsPlatformAdmin } from '@pantry/supabase-client';
import { supabase } from '@/lib/supabaseClient';
```

and change

```tsx
import { NAV_ITEMS } from './navItems';
```

to

```tsx
import { NAV_ITEMS, IconAdmin } from './navItems';
```

Inside `export function MobileNav() {`, right after the existing `const accountRef = useRef<HTMLDivElement>(null);` line, add:

```tsx
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!session) {
      setIsAdmin(false);
      return;
    }
    checkIsPlatformAdmin(supabase)
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [session]);
```

Inside the dropdown `<nav>` block, immediately after the closing `})}` of `{NAV_ITEMS.map((item) => { ... })}` (still inside that same `<nav>`), add:

```tsx
                {isAdmin && (
                  <Link
                    href="/admin/users"
                    onClick={() => setNavOpen(false)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: radius.sm,
                      fontSize: 15,
                      fontWeight: pathname === '/admin/users' ? 700 : 500,
                      textDecoration: 'none',
                      color: pathname === '/admin/users' ? color.primary : color.foreground,
                      background: pathname === '/admin/users' ? color.muted : 'transparent',
                    }}
                  >
                    <IconAdmin />
                    Admin
                  </Link>
                )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Run the full web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds, `/admin/users` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/navItems.tsx apps/web/src/components/Sidebar.tsx apps/web/src/components/MobileNav.tsx
git commit -m "feat(web): show an Admin nav link for platform admins"
```

---

### Task 6: Live verification (after the user applies Task 1's migration and deploys Task 3's function)

**Files:** none — verification only, no code changes expected unless a live-only bug surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–5, live.

- [ ] **Step 1: Confirm the migration landed**

Ask the user to confirm they've run `supabase/migrations/20260916000004_platform_admin_users.sql` via Supabase Studio. Then verify directly:

```sql
select user_id, granted_by, granted_at from platform_admins;
```

Expected: exactly one row, whose `user_id` matches `ronnel.go@gmail.com`'s auth user id (cross-check via `select id from auth.users where email = 'ronnel.go@gmail.com';`), and `granted_by` equal to that same id.

- [ ] **Step 2: Confirm the Edge Function is deployed**

Ask the user to confirm `admin-manage-users` has been deployed (`supabase functions deploy admin-manage-users` or via the dashboard). Then, signed in as the seed admin in a browser session, open the browser devtools console on any page of the app and run:

```js
const { data, error } = await window.supabase.functions.invoke('admin-manage-users', { body: { action: 'list_users' } });
console.log(data, error);
```

(If `window.supabase` isn't exposed globally, use the existing `.tmp-*.mjs` Playwright-script pattern used throughout this session instead — sign in via Supabase JS directly with the seed admin's real credentials is not an option since this assistant must never send real user credentials through a script; drive the actual `/admin/users` page in a real browser session instead, per Step 3.)

- [ ] **Step 3: Live Playwright check of the page and nav**

Write a temporary script (matching the `.tmp-*.mjs` pattern used throughout this session) that:
1. Signs in as `kampuger+plat­adminA${Date.now()}@gmail.com` (a fresh throwaway, not the real seed admin), confirms the "Admin" nav link is **absent** (Sidebar on desktop viewport, hamburger dropdown on a 390px viewport) and that navigating directly to `/admin/users` shows "You don't have access to this page."
2. Note: fully testing the *positive* admin path (nav link present, invite/suspend/promote working) requires signing in as the real seed admin (`ronnel.go@gmail.com`), whose password this assistant does not have — ask the user to either (a) run through that path themselves once and report back, or (b) temporarily grant a throwaway `kampuger+...@gmail.com` test account admin via a direct SQL insert into `platform_admins` (through Studio) so this assistant can drive the positive path end-to-end without touching the real account's credentials, then revoke it afterward.
3. Using whichever admin test account is available: confirm the "Admin" nav link appears, `/admin/users` lists at least one user, the invite form accepts an email and shows a success message, suspending a freshly-invited throwaway test user flips its badge to "Suspended," and unsuspending flips it back.
4. Clean up: delete any throwaway auth users' rows this step created from `platform_admins` if granted; the underlying throwaway auth users themselves are left behind per this session's established convention (deleting an Auth user needs the service_role key, which this assistant never touches directly).

- [ ] **Step 4: Report results**

Summarize what passed, what (if anything) needed a live-only fix, and confirm the feature is ready to use.
