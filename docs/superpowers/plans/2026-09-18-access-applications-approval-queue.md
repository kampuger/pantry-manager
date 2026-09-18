# Access Applications & User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the login page's ungated sign-up with an apply-for-access flow reviewed by a platform admin, give admins a Pending applications queue with bulk approve/reject, and add Delete plus bulk Suspend/Unsuspend/Delete to the existing `/admin/users` table.

**Architecture:** A new `access_applications` table (RLS: anyone can insert a pending row, only platform admins can read/update) holds requests separately from real accounts — approving one is two existing-pattern calls (`inviteUser` then a status update), never a combined operation, so bulk approval can isolate per-item failures. A new `delete_user` action is added to the already-deployed `admin-manage-users` Edge Function, following its existing `suspend_user`/`unsuspend_user` shape exactly. The `/admin/users` page gains a Pending-applications section and checkbox/bulk-toolbar affordances on the existing user table, both using the same per-item-isolated-loop-then-single-refresh pattern already established in this codebase. The login page's sign-up mode is replaced by an apply mode that submits into the new table instead of creating an account.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno), Next.js App Router (`apps/web`), the existing `@pantry/supabase-client` workspace package, Jest.

**Spec:** `docs/superpowers/specs/2026-09-16-access-applications-approval-queue-design.md`

## Global Constraints

- Web only — no `apps/mobile` (React Native) changes (spec Non-goals).
- No captcha, rate-limiting, or other anti-abuse tooling on the public submission endpoint (spec Non-goals).
- No applicant-facing "check my status" page — the one-time inline confirmation on submission is the only feedback (spec Non-goals).
- No admin notification when a new application arrives (spec Non-goals).
- No changes to suspend/unsuspend/grant/revoke behavior or the `platform_admins` table/RLS — this plan is additive, adding exactly one new `admin-manage-users` action (`delete_user`) and reusing `inviteUser`/`suspendUser`/`unsuspendUser` unchanged (spec Non-goals).
- No undo, soft-delete, or archive state for Delete — `admin.auth.admin.deleteUser()` is immediate and permanent; the only safety nets are a `window.confirm(...)` prompt and the database's existing `on delete restrict` on `households.created_by` (spec Non-goals).
- No household-reassignment UI — a user who created a household and can't be deleted shows a clear error the admin resolves manually outside this feature (spec Non-goals).
- Approving an application is always two separate calls — `inviteUser` then `markApplicationApproved` — never combined, so bulk-approve can isolate a failure in one from a failure in the other (spec, `packages/supabase-client` additions).
- Every bulk operation (applications approve/reject, user suspend/unsuspend/delete) uses a per-item-isolated loop that catches each failure individually and refreshes the affected list once after the whole batch — never an unguarded `Promise.all` (spec, UI sections; matches the existing pattern in `compute-and-send-reminders` and the platform admin feature).
- Migrations and Edge Function deploys require Supabase credentials this assistant does not have access to — every such step ends with "hand off to the user," matching every prior migration/Edge-Function task this project has done.

---

### Task 1: Database migration — `access_applications` table, RLS, and type

**Files:**
- Create: `supabase/migrations/20260918000001_access_applications.sql`
- Modify: `packages/supabase-client/src/types.ts` (add the `access_applications` table type)

**Interfaces:**
- Produces: table `access_applications(id uuid, email text, message text, status text, submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid)`, RLS policies gated by the existing `is_platform_admin()` function.
- Consumes: `is_platform_admin()` (already exists, from `20260916000004_platform_admin_users.sql`).

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260918000001_access_applications.sql

-- =========================================================
-- ACCESS APPLICATIONS
-- Holds requests, not accounts — no auth.users row exists for an applicant
-- until an admin approves them (via the existing invite flow, which creates
-- one). Kept separate from platform_admins' suspend/ban mechanism so
-- "Suspended" in the admin's user list never gets confused with "someone
-- who never had access."
-- =========================================================
create table access_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

-- Re-submitting the same email while a prior application is still pending
-- must not create a second row — the insert fails with a unique-violation
-- (code 23505), which the client-side wrapper catches and treats identically
-- to a successful first submission.
create unique index access_applications_pending_email
  on access_applications (email)
  where status = 'pending';

alter table access_applications enable row level security;

-- Deliberately constrains status/reviewed_at/reviewed_by to their
-- just-submitted defaults — an anonymous submitter cannot insert a row that
-- claims to already be approved or reviewed.
create policy "anyone can apply"
  on access_applications for insert
  to anon, authenticated
  with check (status = 'pending' and reviewed_at is null and reviewed_by is null);

create policy "admins can read applications"
  on access_applications for select
  using (is_platform_admin());

create policy "admins can review applications"
  on access_applications for update
  using (is_platform_admin())
  with check (is_platform_admin());

-- No DELETE policy: rejecting an application is a status update, not a row
-- removal — keeps a record of every reviewed application.
```

- [ ] **Step 2: Review the file for syntax correctness**

This repo has no local Postgres/pgTAP setup, so there is no automated way to run this migration here — every migration this project has used is reviewed by eye, applied by the user via Supabase Studio, then verified with a live query. Re-read the SQL above end to end and confirm: `is_platform_admin()` (referenced by the two admin policies) already exists in `supabase/migrations/20260916000004_platform_admin_users.sql`, the partial unique index's `where status = 'pending'` clause matches the `check` constraint's allowed values, and the INSERT policy's `with check` only allows exactly the row shape a fresh submission produces.

- [ ] **Step 3: Add the new table to the hand-maintained Database type**

Open `packages/supabase-client/src/types.ts`. Inside `Tables`, add a new entry immediately after the existing `platform_admins` entry (i.e. right before the closing `};` that ends `Tables`):

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
        Insert: Partial<Database['public']['Tables']['access_applications']['Row']> & {
          email: string;
        };
        Update: Partial<Database['public']['Tables']['access_applications']['Row']>;
        Relationships: [];
      };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p packages/supabase-client/tsconfig.json`
Expected: no errors (this step only changed type declarations, no runtime code yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260918000001_access_applications.sql packages/supabase-client/src/types.ts
git commit -m "feat(db): add access_applications table with RLS"
```

- [ ] **Step 6: Flag the hand-off**

In your final report for this task, state clearly: *this migration is not yet applied to the live database* — the user needs to run it via Supabase Studio (SQL Editor, paste the file contents, run) before Task 7's live verification can happen. Tasks 2–6 do not require the live database (they're code + unit tests against a mocked client) and can proceed without waiting.

---

### Task 2: `packages/supabase-client` — access applications API wrappers

**Files:**
- Create: `packages/supabase-client/src/accessApplications.ts`
- Test: `packages/supabase-client/src/accessApplications.test.ts`
- Modify: `packages/supabase-client/src/index.ts` (add `export * from './accessApplications';`)

**Interfaces:**
- Consumes: `Database` type from `./types` (produced by Task 1); table `access_applications` (`id`, `email`, `message`, `status`, `submitted_at`, `reviewed_at`, `reviewed_by`).
- Produces (consumed by Task 4's UI and Task 6's login page):
  - `interface AccessApplication { id: string; email: string; message: string | null; status: 'pending' | 'approved' | 'rejected'; submittedAt: string; reviewedAt: string | null; reviewedBy: string | null; }`
  - `submitApplication(client, email: string, message?: string): Promise<void>`
  - `listPendingApplications(client): Promise<AccessApplication[]>`
  - `markApplicationApproved(client, applicationId: string, reviewedBy: string): Promise<void>`
  - `markApplicationRejected(client, applicationId: string, reviewedBy: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/supabase-client/src/accessApplications.test.ts
import {
  submitApplication,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
} from './accessApplications';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(handlers: {
  insertResult?: { error: any };
  selectResult?: { data: any; error: any };
  updateResult?: { error: any };
}) {
  const state: any = {};
  state.from = (table: string): any => {
    if (table !== 'access_applications') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => {
        state.lastInsertPayload = payload;
        return Promise.resolve(handlers.insertResult);
      },
      select: (columns: string) => {
        state.lastSelectColumns = columns;
        return {
          eq: (...eqArgs: any[]) => ({
            order: (...orderArgs: any[]) => {
              state.lastEqArgs = eqArgs;
              state.lastOrderArgs = orderArgs;
              return Promise.resolve(handlers.selectResult);
            },
          }),
        };
      },
      update: (payload: any) => {
        state.lastUpdatePayload = payload;
        return {
          eq: (...eqArgs: any[]) => {
            state.lastUpdateEqArgs = eqArgs;
            return Promise.resolve(handlers.updateResult);
          },
        };
      },
    };
  };
  return state as SupabaseClient<Database> & {
    lastInsertPayload?: any;
    lastSelectColumns?: any;
    lastEqArgs?: any[];
    lastOrderArgs?: any[];
    lastUpdatePayload?: any;
    lastUpdateEqArgs?: any[];
  };
}

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

  it('resolves successfully on a duplicate-pending-email unique violation (code 23505)', async () => {
    const client = fakeClient({ insertResult: { error: { code: '23505', message: 'duplicate key value' } } });
    await expect(submitApplication(client, 'dup@example.com')).resolves.toBeUndefined();
  });

  it('throws on any other error', async () => {
    const client = fakeClient({ insertResult: { error: { code: '23514', message: 'check constraint violated' } } });
    await expect(submitApplication(client, 'bad@example.com')).rejects.toThrow('check constraint violated');
  });
});

describe('listPendingApplications', () => {
  it('selects pending applications ordered oldest-first and maps snake_case to camelCase', async () => {
    const rows = [
      {
        id: 'app-1',
        email: 'a@example.com',
        message: 'hi',
        status: 'pending',
        submitted_at: '2026-09-17T00:00:00.000Z',
        reviewed_at: null,
        reviewed_by: null,
      },
    ];
    const client = fakeClient({ selectResult: { data: rows, error: null } });

    expect(await listPendingApplications(client)).toEqual([
      {
        id: 'app-1',
        email: 'a@example.com',
        message: 'hi',
        status: 'pending',
        submittedAt: '2026-09-17T00:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
      },
    ]);
    expect(client.lastEqArgs).toEqual(['status', 'pending']);
    expect(client.lastOrderArgs).toEqual(['submitted_at', { ascending: true }]);
  });

  it('returns an empty array when there is no data', async () => {
    const client = fakeClient({ selectResult: { data: null, error: null } });
    expect(await listPendingApplications(client)).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ selectResult: { data: null, error: new Error('boom') } });
    await expect(listPendingApplications(client)).rejects.toThrow('boom');
  });
});

describe('markApplicationApproved', () => {
  it('updates status to approved with reviewed_at and reviewed_by, filtered by id', async () => {
    const client = fakeClient({ updateResult: { error: null } });
    await markApplicationApproved(client, 'app-1', 'admin-1');
    expect(client.lastUpdatePayload.status).toBe('approved');
    expect(client.lastUpdatePayload.reviewed_by).toBe('admin-1');
    expect(typeof client.lastUpdatePayload.reviewed_at).toBe('string');
    expect(client.lastUpdateEqArgs).toEqual(['id', 'app-1']);
  });

  it('throws when the update errors', async () => {
    const client = fakeClient({ updateResult: { error: new Error('update failed') } });
    await expect(markApplicationApproved(client, 'app-1', 'admin-1')).rejects.toThrow('update failed');
  });
});

describe('markApplicationRejected', () => {
  it('updates status to rejected with reviewed_at and reviewed_by, filtered by id', async () => {
    const client = fakeClient({ updateResult: { error: null } });
    await markApplicationRejected(client, 'app-2', 'admin-1');
    expect(client.lastUpdatePayload.status).toBe('rejected');
    expect(client.lastUpdatePayload.reviewed_by).toBe('admin-1');
    expect(typeof client.lastUpdatePayload.reviewed_at).toBe('string');
    expect(client.lastUpdateEqArgs).toEqual(['id', 'app-2']);
  });

  it('throws when the update errors', async () => {
    const client = fakeClient({ updateResult: { error: new Error('update failed') } });
    await expect(markApplicationRejected(client, 'app-2', 'admin-1')).rejects.toThrow('update failed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest accessApplications.test.ts`
Expected: FAIL — `Cannot find module './accessApplications'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// packages/supabase-client/src/accessApplications.ts
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AccessApplication {
  id: string;
  email: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const DUPLICATE_PENDING_APPLICATION_CODE = '23505';

/**
 * Inserts a pending application. If one is already pending for this email,
 * the partial unique index on access_applications(email) where status =
 * 'pending' rejects the insert with a 23505 unique-violation — from the
 * caller's perspective, "already in the queue" and "just added to the
 * queue" should look identical, so that specific error is swallowed here
 * rather than thrown.
 */
export async function submitApplication(
  client: SupabaseClient<Database>,
  email: string,
  message?: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .insert({ email, message: message?.trim() || null });
  if (error && (error as PostgrestError).code !== DUPLICATE_PENDING_APPLICATION_CODE) {
    throw error;
  }
}

/** RLS restricts this to admins already; this function adds no additional authorization logic. */
export async function listPendingApplications(client: SupabaseClient<Database>): Promise<AccessApplication[]> {
  const { data, error } = await client
    .from('access_applications')
    .select('*')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    message: row.message,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  }));
}

export async function markApplicationApproved(
  client: SupabaseClient<Database>,
  applicationId: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
    .eq('id', applicationId);
  if (error) throw error;
}

export async function markApplicationRejected(
  client: SupabaseClient<Database>,
  applicationId: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
    .eq('id', applicationId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest accessApplications.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Export the new module**

In `packages/supabase-client/src/index.ts`, add this line (after `export * from './platformAdmin';`):

```ts
export * from './accessApplications';
```

- [ ] **Step 6: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS (existing ones untouched), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/supabase-client/src/accessApplications.ts packages/supabase-client/src/accessApplications.test.ts packages/supabase-client/src/index.ts
git commit -m "feat(supabase-client): add access applications API wrappers"
```

---

### Task 3: `delete_user` action — Edge Function + client wrapper

**Files:**
- Modify: `supabase/functions/admin-manage-users/index.ts`
- Modify: `packages/supabase-client/src/platformAdmin.ts`
- Modify: `packages/supabase-client/src/platformAdmin.test.ts`

**Interfaces:**
- Consumes: `invokeAdminFn` (already exists in `platformAdmin.ts`); the Edge Function's existing self-target-guard pattern (`suspend_user`/`unsuspend_user`).
- Produces (consumed by Task 5's UI): `deleteUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void>`.

- [ ] **Step 1: Add the `delete_user` action to the Edge Function**

In `supabase/functions/admin-manage-users/index.ts`, the file currently ends its action chain with the `suspend_user`/`unsuspend_user` block followed directly by the final fallback:

```ts
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

Insert a new `delete_user` block between that closing `}` and the final `return jsonResponse({ status: 'error', message: \`Unknown action...`:

```ts
  if (action === 'delete_user') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) {
      return jsonResponse({ status: 'error', message: 'targetUserId is required' }, 400);
    }
    if (targetUserId === callerId) {
      return jsonResponse({ status: 'error', message: 'Cannot delete your own account' }, 400);
    }
    const { error } = await admin.auth.admin.deleteUser(targetUserId);
    if (error) {
      // households.created_by is `on delete restrict` — deleting a user who
      // created a household fails at the database level. Translate that
      // into something an admin can act on instead of a raw
      // constraint-violation message. Match broadly (the word "household"
      // OR "foreign key") so the translation still fires even if Supabase's
      // exact phrasing differs from what's guessed here — Task 7's live
      // verification confirms the real text.
      const isHouseholdRestrictViolation = /household/i.test(error.message) || /foreign key/i.test(error.message);
      const message = isHouseholdRestrictViolation
        ? "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again."
        : error.message;
      return jsonResponse({ status: 'error', message }, 400);
    }
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ status: 'error', message: `Unknown action: ${action}` }, 400);
});
```

- [ ] **Step 2: Add the `deleteUser` client wrapper**

In `packages/supabase-client/src/platformAdmin.ts`, add this export after `unsuspendUser` and before the `grantAdmin`/`revokeAdmin` block:

```ts
export async function deleteUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  await invokeAdminFn(client, { action: 'delete_user', targetUserId });
}
```

- [ ] **Step 3: Write the failing tests**

In `packages/supabase-client/src/platformAdmin.test.ts`, add `deleteUser` to the existing import list at the top of the file:

```ts
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  grantAdmin,
  revokeAdmin,
} from './platformAdmin';
```

Then add this new `describe` block after the existing `describe('suspendUser / unsuspendUser', ...)` block and before `describe('grantAdmin / revokeAdmin', ...)`:

```ts
describe('deleteUser', () => {
  it('invokes admin-manage-users with delete_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await deleteUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'delete_user', targetUserId: 'user-2' },
    });
  });

  it('throws with the households-restrict-violation message when the function reports one', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: new Error(
        "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again."
      ),
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(deleteUser(client, 'user-3')).rejects.toThrow('household');
  });

  it('throws when the function call errors for any other reason', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('Cannot delete your own account') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(deleteUser(client, 'self-id')).rejects.toThrow('Cannot delete your own account');
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest platformAdmin.test.ts`
Expected: PASS, all cases green (16 existing tests plus the 3 new ones — if the count differs, re-check nothing else in the file changed).

- [ ] **Step 5: Typecheck**

Run: `cd packages/supabase-client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/admin-manage-users/index.ts packages/supabase-client/src/platformAdmin.ts packages/supabase-client/src/platformAdmin.test.ts
git commit -m "feat: add delete_user action to admin-manage-users"
```

- [ ] **Step 7: Flag the hand-off**

State clearly in your report: the updated Edge Function is not yet deployed. The user needs to run `supabase functions deploy admin-manage-users` themselves — this assistant has no CLI-deploy credentials for this project. Task 7's live verification (specifically, confirming the households-restrict-violation error text) needs this deploy first.

---

### Task 4: Admin page — Pending applications queue

**Files:**
- Modify: `apps/web/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `listPendingApplications`, `markApplicationApproved`, `markApplicationRejected`, `type AccessApplication` (Task 2); `inviteUser` (already imported on this page).
- Produces: nothing consumed by later tasks (Task 5 edits the same file but a different section).

- [ ] **Step 1: Add the new imports**

In `apps/web/src/app/admin/users/page.tsx`, the top import block currently reads:

```tsx
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
```

Change it to:

```tsx
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
  type AdminUserRow,
  type AccessApplication,
} from '@pantry/supabase-client';
```

- [ ] **Step 2: Add applications state**

Immediately after the existing `const [busyUserId, setBusyUserId] = useState<string | null>(null);` line, add:

```tsx
  const [applications, setApplications] = useState<AccessApplication[]>([]);
  const [applicationsError, setApplicationsError] = useState<string | null>(null);
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<Set<string>>(new Set());
  const [applicationsBusy, setApplicationsBusy] = useState(false);
  const [applicationRowErrors, setApplicationRowErrors] = useState<Record<string, string>>({});
```

- [ ] **Step 3: Add `refreshApplications` and wire it into the existing access-check effect**

Immediately after the closing `}` of the existing `refreshUsers` function (and before the `useEffect` that calls it), add:

```tsx
  async function refreshApplications() {
    try {
      setApplications(await listPendingApplications(supabase));
    } catch (err) {
      setApplicationsError(err instanceof Error ? err.message : 'Failed to load applications');
    }
  }
```

Then change the existing effect from:

```tsx
    checkIsPlatformAdmin(supabase)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) refreshUsers();
      })
      .finally(() => setCheckingAccess(false));
```

to:

```tsx
    checkIsPlatformAdmin(supabase)
      .then((ok) => {
        setIsAdmin(ok);
        if (ok) {
          refreshUsers();
          refreshApplications();
        }
      })
      .finally(() => setCheckingAccess(false));
```

- [ ] **Step 4: Add selection helpers and the approve/reject handlers**

Immediately after the existing `handleToggleAdmin` function (and before the `if (authLoading || checkingAccess) return null;` line), add:

```tsx
  function toggleApplicationSelected(id: string) {
    setSelectedApplicationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllApplications() {
    setSelectedApplicationIds((prev) =>
      prev.size === applications.length ? new Set() : new Set(applications.map((a) => a.id))
    );
  }

  async function runApplicationAction(
    ids: string[],
    action: (application: AccessApplication) => Promise<void>
  ) {
    setApplicationsBusy(true);
    const errors: Record<string, string> = {};
    for (const id of ids) {
      const application = applications.find((a) => a.id === id);
      if (!application) continue;
      try {
        await action(application);
      } catch (err) {
        errors[id] = err instanceof Error ? err.message : 'Action failed';
      }
    }
    setApplicationRowErrors(errors);
    setSelectedApplicationIds(new Set());
    await refreshApplications();
    setApplicationsBusy(false);
  }

  async function handleApprove(ids: string[]) {
    if (!session) return;
    await runApplicationAction(ids, async (application) => {
      await inviteUser(supabase, application.email);
      await markApplicationApproved(supabase, application.id, session.user.id);
    });
  }

  async function handleReject(ids: string[]) {
    if (!session) return;
    await runApplicationAction(ids, async (application) => {
      await markApplicationRejected(supabase, application.id, session.user.id);
    });
  }
```

- [ ] **Step 5: Render the Pending applications section**

In the main return's JSX, the page currently goes straight from `</header>` to the invite `<form>`:

```tsx
      </header>

      <form
        onSubmit={handleInvite}
```

Insert a new section between them:

```tsx
      </header>

      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0, letterSpacing: '-0.01em' }}>Pending applications</h2>
          {selectedApplicationIds.size > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleApprove([...selectedApplicationIds])}
                disabled={applicationsBusy}
                style={buttonStyle('primary')}
              >
                Approve {selectedApplicationIds.size} selected
              </button>
              <button
                onClick={() => handleReject([...selectedApplicationIds])}
                disabled={applicationsBusy}
                style={buttonStyle('secondary')}
              >
                Reject {selectedApplicationIds.size} selected
              </button>
            </div>
          )}
        </div>

        {applicationsError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{applicationsError}</p>}

        {applications.length === 0 ? (
          <p style={{ ...cardStyle, padding: 16, margin: 0, color: color.mutedForeground, fontSize: 14 }}>
            No pending applications.
          </p>
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {applications.map((application) => (
              <div key={application.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selectedApplicationIds.has(application.id)}
                    onChange={() => toggleApplicationSelected(application.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{application.email}</div>
                    {application.message && (
                      <div style={{ fontSize: 13, color: color.mutedForeground }}>{application.message}</div>
                    )}
                    <div style={{ fontSize: 12, color: color.mutedForeground }}>
                      Applied {formatJoined(application.submittedAt)}
                    </div>
                  </div>
                </div>
                {applicationRowErrors[application.id] && (
                  <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{applicationRowErrors[application.id]}</p>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleApprove([application.id])} disabled={applicationsBusy} style={buttonStyle('primary')}>
                    Approve
                  </button>
                  <button onClick={() => handleReject([application.id])} disabled={applicationsBusy} style={buttonStyle('secondary')}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...cardStyle, padding: 20, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px', width: 32 }}>
                    <input
                      type="checkbox"
                      checked={applications.length > 0 && selectedApplicationIds.size === applications.length}
                      onChange={toggleSelectAllApplications}
                    />
                  </th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Message</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }}>Applied</th>
                  <th style={{ padding: '8px 10px', color: color.mutedForeground, fontWeight: 600 }} />
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id} style={{ borderBottom: `1px solid ${color.border}` }}>
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={selectedApplicationIds.has(application.id)}
                        onChange={() => toggleApplicationSelected(application.id)}
                      />
                    </td>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{application.email}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{application.message ?? '—'}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(application.submittedAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => handleApprove([application.id])} disabled={applicationsBusy} style={buttonStyle('primary')}>
                            Approve
                          </button>
                          <button onClick={() => handleReject([application.id])} disabled={applicationsBusy} style={buttonStyle('secondary')}>
                            Reject
                          </button>
                        </div>
                        {applicationRowErrors[application.id] && (
                          <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{applicationRowErrors[application.id]}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form
        onSubmit={handleInvite}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/admin/users/page.tsx
git commit -m "feat(web): add pending applications queue to /admin/users"
```

---

### Task 5: Admin page — bulk Suspend/Unsuspend/Delete + per-row Delete for the user table

**Files:**
- Modify: `apps/web/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `deleteUser` (Task 3); `suspendUser`, `unsuspendUser` (already imported on this page); `AdminUserRow` (already imported).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `deleteUser` import**

Add `deleteUser,` to the existing named-import list from `@pantry/supabase-client` (from Task 4, it now reads through `revokeAdmin,` then `listPendingApplications,` etc. — add `deleteUser,` immediately after `revokeAdmin,`):

```tsx
  revokeAdmin,
  deleteUser,
  listPendingApplications,
```

- [ ] **Step 2: Add selection state and derived selectable-ids**

Immediately after the applications state block added in Task 4 (after `const [applicationRowErrors, setApplicationRowErrors] = useState<Record<string, string>>({});`), add:

```tsx
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userRowErrors, setUserRowErrors] = useState<Record<string, string>>({});
  const [bulkUserBusy, setBulkUserBusy] = useState(false);
```

- [ ] **Step 3: Add selection helpers and the bulk/delete handlers**

Immediately after the `handleReject` function added in Task 4 (and before `if (authLoading || checkingAccess) return null;`), add:

```tsx
  const selectableUserIds = session ? users.filter((u) => u.id !== session.user.id).map((u) => u.id) : [];
  const allSelectableUsersSelected =
    selectableUserIds.length > 0 && selectableUserIds.every((id) => selectedUserIds.has(id));

  function toggleUserSelected(id: string) {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllUsers() {
    setSelectedUserIds((prev) =>
      selectableUserIds.length > 0 && selectableUserIds.every((id) => prev.has(id)) ? new Set() : new Set(selectableUserIds)
    );
  }

  async function runUserAction(ids: string[], action: (userId: string) => Promise<void>) {
    setBulkUserBusy(true);
    const errors: Record<string, string> = {};
    for (const id of ids) {
      try {
        await action(id);
      } catch (err) {
        errors[id] = err instanceof Error ? err.message : 'Action failed';
      }
    }
    setUserRowErrors(errors);
    setSelectedUserIds(new Set());
    await refreshUsers();
    setBulkUserBusy(false);
  }

  async function handleBulkSuspend() {
    await runUserAction([...selectedUserIds], (id) => suspendUser(supabase, id));
  }

  async function handleBulkUnsuspend() {
    await runUserAction([...selectedUserIds], (id) => unsuspendUser(supabase, id));
  }

  async function handleBulkDelete() {
    const ids = [...selectedUserIds];
    const n = ids.length;
    if (!window.confirm(`Delete ${n} user${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await runUserAction(ids, (id) => deleteUser(supabase, id));
  }

  async function handleDeleteSingle(user: AdminUserRow) {
    if (!window.confirm(`Delete ${user.email ?? 'this user'}? This cannot be undone.`)) return;
    await runUserAction([user.id], (id) => deleteUser(supabase, id));
  }
```

Note: `handleDeleteSingle` deliberately reuses `runUserAction` for a one-item selection — a single delete and a one-item bulk delete are the same code path with different confirmation copy, matching the spec exactly.

- [ ] **Step 4: Add the bulk toolbar above the user list**

The page currently goes from the error paragraphs straight to the mobile/desktop branch:

```tsx
      {loadError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{loadError}</p>}
      {actionError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{actionError}</p>}

      {isMobile ? (
```

Insert the toolbar between them:

```tsx
      {loadError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{loadError}</p>}
      {actionError && <p style={{ color: color.destructive, fontSize: 14, margin: 0 }}>{actionError}</p>}

      {selectedUserIds.size > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={handleBulkSuspend} disabled={bulkUserBusy} style={buttonStyle('secondary')}>
            Suspend selected ({selectedUserIds.size})
          </button>
          <button onClick={handleBulkUnsuspend} disabled={bulkUserBusy} style={buttonStyle('secondary')}>
            Unsuspend selected ({selectedUserIds.size})
          </button>
          <button onClick={handleBulkDelete} disabled={bulkUserBusy} style={buttonStyle('danger')}>
            Delete selected ({selectedUserIds.size})
          </button>
        </div>
      )}

      {isMobile ? (
```

- [ ] **Step 5: Add a checkbox and Delete button to the mobile card view**

The mobile card currently renders (inside the `isMobile ? (...)` branch):

```tsx
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
```

Replace it with:

```tsx
              <div key={user.id} style={{ ...cardStyle, padding: 16, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(user.id)}
                    disabled={isSelf}
                    title={isSelf ? "You can't select your own account" : undefined}
                    onChange={() => toggleUserSelected(user.id)}
                    style={{ marginTop: 3 }}
                  />
                  <div style={{ display: 'grid', gap: 8, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                      {user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}
                    </div>
                    <div style={{ fontSize: 12, color: color.mutedForeground }}>Joined {formatJoined(user.createdAt)}</div>
                  </div>
                </div>
                {userRowErrors[user.id] && (
                  <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{userRowErrors[user.id]}</p>
                )}
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
                  <button
                    onClick={() => handleDeleteSingle(user)}
                    disabled={bulkUserBusy || isSelf}
                    title={isSelf ? "You can't delete your own account" : undefined}
                    style={buttonStyle('danger')}
                  >
                    Delete
                  </button>
                </div>
              </div>
```

- [ ] **Step 6: Add a header checkbox, row checkboxes, and a Delete button to the desktop table**

The desktop table currently renders (inside the `) : ( ... )` branch):

```tsx
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
```

Replace it with:

```tsx
            <thead>
              <tr style={{ borderBottom: `1px solid ${color.border}`, textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', width: 32 }}>
                  <input type="checkbox" checked={allSelectableUsersSelected} onChange={toggleSelectAllUsers} />
                </th>
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
                    <td style={{ padding: '10px' }}>
                      <input
                        type="checkbox"
                        checked={selectedUserIds.has(user.id)}
                        disabled={isSelf}
                        title={isSelf ? "You can't select your own account" : undefined}
                        onChange={() => toggleUserSelected(user.id)}
                      />
                    </td>
                    <td style={{ padding: '10px', wordBreak: 'break-all' }}>{user.email ?? '(no email)'}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={badgeStyle(suspended ? 'destructive' : 'success')}>{suspended ? 'Suspended' : 'Active'}</span>
                    </td>
                    <td style={{ padding: '10px' }}>{user.isAdmin && <span style={badgeStyle('muted')}>Admin</span>}</td>
                    <td style={{ padding: '10px', color: color.mutedForeground }}>{formatJoined(user.createdAt)}</td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'grid', gap: 4 }}>
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
                          <button
                            onClick={() => handleDeleteSingle(user)}
                            disabled={bulkUserBusy || isSelf}
                            title={isSelf ? "You can't delete your own account" : undefined}
                            style={buttonStyle('danger')}
                          >
                            Delete
                          </button>
                        </div>
                        {userRowErrors[user.id] && (
                          <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{userRowErrors[user.id]}</p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Run the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/admin/users/page.tsx
git commit -m "feat(web): add bulk suspend/unsuspend/delete and per-row delete to /admin/users"
```

---

### Task 6: Login page — `apply` mode replaces `sign-up`

**Files:**
- Modify: `apps/web/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `submitApplication` (Task 2); `supabase` client singleton from `@/lib/supabaseClient` (not currently imported on this page).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add imports**

At the top of `apps/web/src/app/login/page.tsx`, change:

```tsx
import { useAuth } from '@/lib/AuthProvider';
import { color, radius, shadow } from '@/lib/theme';
```

to:

```tsx
import { useAuth } from '@/lib/AuthProvider';
import { supabase } from '@/lib/supabaseClient';
import { submitApplication } from '@pantry/supabase-client';
import { color, radius, shadow } from '@/lib/theme';
```

- [ ] **Step 2: Change the `Mode` type**

Change:

```tsx
type Mode = 'sign-in' | 'sign-up' | 'forgot-password';
```

to:

```tsx
type Mode = 'sign-in' | 'apply' | 'forgot-password';
```

- [ ] **Step 3: Update state — drop the unused `signUp` destructure, add `message` and `applicationSubmitted`**

Change:

```tsx
  const { session, loading, signIn, signUp, resetPassword } = useAuth();
```

to:

```tsx
  const { session, loading, signIn, resetPassword } = useAuth();
```

`useAuth()`'s `signUp` function itself stays in `AuthProvider.tsx`, unused by this page — removing it from the provider is out of scope (YAGNI).

Immediately after the existing `const [mounted, setMounted] = useState(false);` line, add:

```tsx
  const [message, setMessage] = useState('');
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
```

- [ ] **Step 4: Update `switchMode` to reset the new state**

Change:

```tsx
  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setStatusIsError(false);
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
  }
```

- [ ] **Step 5: Rewrite `handleSubmit`**

Change:

```tsx
    const result = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);

    if (result.error) {
      setStatusIsError(true);
      setStatus(result.error);
      return;
    }

    if (mode === 'sign-up') {
      setStatus('Account created. If email confirmation is enabled on this project, check your inbox before signing in.');
      return;
    }

    router.push('/');
  }
```

to:

```tsx
    if (mode === 'apply') {
      try {
        await submitApplication(supabase, email.trim(), message);
        setApplicationSubmitted(true);
      } catch (err) {
        setStatusIsError(true);
        setStatus(err instanceof Error ? err.message : 'Failed to submit application');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const result = await signIn(email, password);
    setSubmitting(false);

    if (result.error) {
      setStatusIsError(true);
      setStatus(result.error);
      return;
    }

    router.push('/');
  }
```

(The `if (mode === 'forgot-password') { ... return; }` block right before this stays exactly as-is — only the code after it changes.)

- [ ] **Step 6: Update heading, subheading, and submit label**

Change:

```tsx
  const heading = mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create your account' : 'Reset your password';
  const subheading =
    mode === 'sign-in'
      ? "Sign in to see what's in your kitchen."
      : mode === 'sign-up'
        ? 'Set up your household in under a minute.'
        : "Enter your email and we'll send you a reset link.";
  const submitLabel = mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : 'Send reset link';
```

to:

```tsx
  const heading = mode === 'sign-in' ? 'Welcome back' : mode === 'apply' ? 'Apply for access' : 'Reset your password';
  const subheading =
    mode === 'sign-in'
      ? "Sign in to see what's in your kitchen."
      : mode === 'apply'
        ? "Tell us a bit about you — we'll review your request and get back to you."
        : "Enter your email and we'll send you a reset link.";
  const submitLabel = mode === 'sign-in' ? 'Sign in' : mode === 'apply' ? 'Submit application' : 'Send reset link';
```

- [ ] **Step 7: Replace the Password field with a conditional Password/message field, and gate the whole form on `applicationSubmitted`**

Change:

```tsx
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginTop: 26 }}>
```

to:

```tsx
            {mode === 'apply' && applicationSubmitted ? (
              <p
                role="status"
                style={{
                  marginTop: 26,
                  padding: '14px 16px',
                  borderRadius: radius.sm,
                  fontSize: 14,
                  lineHeight: 1.6,
                  background: color.successBg,
                  color: color.success,
                }}
              >
                Your application has been submitted. We&apos;ll review it and get in touch once you&apos;re approved.
              </p>
            ) : (
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16, marginTop: 26 }}>
```

Then change:

```tsx
              {mode !== 'forgot-password' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <label htmlFor="password" style={{ fontSize: 13, fontWeight: 600, color: color.mutedForeground }}>
                      Password
                    </label>
                    {mode === 'sign-in' && (
                      <button
                        type="button"
                        onClick={() => switchMode('forgot-password')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, fontWeight: 600, color: color.primary, fontFamily: 'inherit' }}
                        suppressHydrationWarning
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: color.mutedForeground, pointerEvents: 'none' }}>
                      <IconLock />
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      style={{ ...fieldStyle(passwordFocused), paddingRight: 42 }}
                      suppressHydrationWarning
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 6,
                        color: color.mutedForeground,
                        display: 'flex',
                      }}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
              )}
```

to:

```tsx
              {mode === 'sign-in' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <label htmlFor="password" style={{ fontSize: 13, fontWeight: 600, color: color.mutedForeground }}>
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => switchMode('forgot-password')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12.5, fontWeight: 600, color: color.primary, fontFamily: 'inherit' }}
                      suppressHydrationWarning
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: color.mutedForeground, pointerEvents: 'none' }}>
                      <IconLock />
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      style={{ ...fieldStyle(passwordFocused), paddingRight: 42 }}
                      suppressHydrationWarning
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: 10,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 6,
                        color: color.mutedForeground,
                        display: 'flex',
                      }}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
              )}

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

Finally, close the new conditional. Change:

```tsx
                {submitting ? 'Please wait…' : submitLabel}
              </button>
            </form>
```

to:

```tsx
                {submitting ? 'Please wait…' : submitLabel}
              </button>
            </form>
            )}
```

- [ ] **Step 8: Update the mode-switch link labels**

Change:

```tsx
                <span style={{ color: color.mutedForeground }}>
                  {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
                  <button
                    onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600, color: color.primary }}
                    suppressHydrationWarning
                  >
                    {mode === 'sign-in' ? 'Sign up' : 'Sign in'}
                  </button>
                </span>
```

to:

```tsx
                <span style={{ color: color.mutedForeground }}>
                  {mode === 'sign-in' ? "Don't have an account? " : 'Already have an account? '}
                  <button
                    onClick={() => switchMode(mode === 'sign-in' ? 'apply' : 'sign-in')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 600, color: color.primary }}
                    suppressHydrationWarning
                  >
                    {mode === 'sign-in' ? 'Apply for access' : 'Sign in'}
                  </button>
                </span>
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: no errors. (If `signUp` shows as unused-import noise anywhere else in the file, it shouldn't — it was only ever referenced via the destructure removed in Step 3.)

- [ ] **Step 10: Run the web build**

Run: `cd apps/web && npm run build`
Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/app/login/page.tsx
git commit -m "feat(web): replace sign-up with an apply-for-access flow"
```

---

### Task 7: Live verification (after the user applies Task 1's migration and deploys Task 3's function)

**Files:** none — verification only, no code changes expected unless a live-only bug surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–6, live.

- [ ] **Step 1: Confirm the migration landed and verify RLS directly**

Ask the user to confirm they've run `supabase/migrations/20260918000001_access_applications.sql` via Supabase Studio. Then verify directly:

```sql
select id, email, status from access_applications;
```

Expected: query succeeds (table exists), returns zero rows on a fresh apply.

Then, matching the spec's Testing section exactly, verify the RLS policies themselves (via `curl` against the REST endpoint with the anon key, or Supabase Studio's SQL editor run as different roles):
1. An anonymous `insert` of `{ "email": "rls-check@example.com" }` succeeds.
2. A second anonymous `insert` of the same email while it's still `pending` fails with a unique-violation (Postgres code `23505`).
3. A `select` or `update` against `access_applications` using the anon key (not an authenticated admin session) returns no rows / is rejected — confirming SELECT and UPDATE are admin-only.

Clean up the `rls-check@example.com` row afterward via Studio.

- [ ] **Step 2: Confirm the Edge Function redeploy landed**

Ask the user to confirm `admin-manage-users` has been redeployed (`supabase functions deploy admin-manage-users`). A basic reachability check from this assistant's own environment (no credentials needed beyond the public anon key, matching the pattern already used earlier in this project):

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$NEXT_PUBLIC_SUPABASE_URL/functions/v1/admin-manage-users" \
  -H "Content-Type: application/json" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -d '{"action":"delete_user"}'
```

Expected: `HTTP 401` (rejected for lacking a bearer token) — confirms the function is live; it does not confirm `delete_user` specifically works, which needs Step 4 below.

- [ ] **Step 3: Live Playwright check of the apply flow and the pending-applications queue**

Write a temporary script (matching the `.tmp-*.mjs` pattern used throughout this project) that:
1. With no session active, navigates to `/login`, switches to "Apply for access", submits a fresh throwaway email (`kampuger+apply${Date.now()}@gmail.com`) with a message, and confirms the form is replaced by the "Your application has been submitted..." confirmation panel — and that no session was created as a side effect (still on `/login`, not redirected to `/`).
2. Submits the exact same email a second time and confirms the identical confirmation panel appears again (not an error) — this is the duplicate-pending-email path.
3. Signs in as the real seed admin is not possible without their password; instead, ask the user to sign in as `ronnel.go@gmail.com` themselves and confirm the application from step 1 appears once (not twice) in the "Pending applications" section on `/admin/users`, with the message text visible.
4. Ask the user to select it via its row checkbox and click "Approve N selected," then confirm: the application disappears from the pending list, and the throwaway email receives an invite email (per the already-verified `INVITE_REDIRECT_URL` fix, it should point at `https://meraki-pantry-tracker.vercel.app/reset-password`).
5. Seed two more pending applications directly via REST (anon key, `insert` into `access_applications` — this table's own INSERT policy allows anonymous inserts, matching what the public apply form does), select all via the header checkbox, and ask the user to bulk-reject them; confirm both disappear from the pending list.

- [ ] **Step 4: Live check of Delete, including the households-restrict case**

Ask the user to, from `/admin/users`:
1. Confirm their own row's checkbox is disabled (both in the desktop table and, on a narrow viewport, the mobile card) and cannot be added to a selection.
2. Select two throwaway test users (existing junk accounts from earlier in this project are fine for this), bulk-suspend them, confirm both flip to "Suspended," then bulk-unsuspend and confirm they flip back.
3. Select one throwaway user, click "Delete selected," decline the confirm dialog, and confirm nothing happened (user still present) — then repeat and accept, confirming the user disappears from the list.
4. **Specifically and separately**: using a throwaway account, sign in as that user in a separate session and have them create a household (so they become a real `households.created_by`). Back in the admin panel, attempt to delete that user and confirm the response is the clear "This user created a household and can't be deleted..." message rather than a raw database error. If the actual error text Supabase's Admin API returns doesn't match the `/household/i` or `/foreign key/i` patterns in Task 3's translation code, note the real text and fix the regex in `supabase/functions/admin-manage-users/index.ts` to match it, then ask the user to redeploy again.

- [ ] **Step 5: Report results**

Summarize what passed, what (if anything) needed a live-only fix, and confirm the feature is ready to use.
