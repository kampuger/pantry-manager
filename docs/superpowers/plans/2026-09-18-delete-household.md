# Delete Household (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin delete an arbitrary household directly from `/admin/users`, right where a blocked user-deletion already surfaces the reason, and have the user deletion retried automatically in the same click.

**Architecture:** Three new, purely additive RLS policies let a platform admin `SELECT`/`DELETE` any household (and `SELECT` its members for a count) without touching the existing owner-scoped policies at all — multiple permissive Postgres policies for the same table+command combine with `OR`. Two new `packages/supabase-client` functions (`getHouseholdOwnedBy`, `deleteHousehold`) are plain RLS-gated table calls, no Edge Function involved, following the exact precedent `grantAdmin`/`revokeAdmin` already set. `/admin/users` detects the known households-restrict error message by substring match and offers a button that looks up the blocking household, confirms, deletes it, then retries the user delete — reusing the page's existing per-row action machinery unchanged.

**Tech Stack:** Supabase (Postgres + RLS), Next.js App Router (`apps/web`), the existing `@pantry/supabase-client` workspace package, Jest.

**Spec:** `docs/superpowers/specs/2026-09-18-delete-household-design.md`

## Global Constraints

- Admin-only — no self-service deletion UI for a household owner (spec Non-goals). The DB already lets an `OWNER` delete their own household via a pre-existing policy; this plan adds nothing for that path.
- No standalone "browse all households" admin view — the action lives only inline on the existing delete-user failure (spec Non-goals).
- No richer pre-delete preview beyond household name + member count — no pantry item counts or other data-impact report (spec Non-goals).
- No undo, soft-delete, or archive state — immediate and permanent, with `window.confirm(...)` as the only safety net, matching the existing `deleteUser` precedent exactly (spec Non-goals).
- No change to `admin-manage-users`' `delete_user` action or its proactive households-created_by check — its exact error message stays unchanged (spec Non-goals).
- `apps/mobile` is untouched — mobile work is paused per current direction (spec Non-goals).

---

### Task 1: Database migration — platform-admin RLS policies for `households` and `household_members`

**Files:**
- Create: `supabase/migrations/20260918000003_delete_household_admin.sql`

**Interfaces:**
- Consumes: `is_platform_admin()` (already exists, `supabase/migrations/20260916000004_platform_admin_users.sql`).
- Produces: new DELETE policy `"platform admins can delete any household"` on `households`; new SELECT policy `"platform admins can view any household"` on `households`; new SELECT policy `"platform admins can view any household's members"` on `household_members`. Consumed by Task 2's `getHouseholdOwnedBy`/`deleteHousehold`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260918000003_delete_household_admin.sql

-- =========================================================
-- ADMIN HOUSEHOLD DELETION
-- Lets a platform admin delete an arbitrary household (and, via the
-- existing `on delete cascade` foreign keys, everything attached to it) to
-- unblock admin-manage-users' delete_user action, which is blocked by
-- households.created_by ... on delete restrict while the household still
-- exists. Also lets an admin read an arbitrary household's name and member
-- count for the confirmation dialog before deleting it — households' and
-- household_members' existing SELECT policies only cover a household's own
-- creator/members, not an outside platform admin. These are additional,
-- purely additive policies: Postgres combines multiple permissive policies
-- for the same table+command with OR, so the existing owner/member-scoped
-- policies on both tables are completely unaffected.
-- =========================================================
create policy "platform admins can delete any household"
  on households for delete
  using (is_platform_admin());

create policy "platform admins can view any household"
  on households for select
  using (is_platform_admin());

create policy "platform admins can view any household's members"
  on household_members for select
  using (is_platform_admin());
```

- [ ] **Step 2: Review the file for syntax correctness**

This repo has no local Postgres/pgTAP setup, so there is no automated way to run this migration here — it is reviewed by eye, applied by the user via Supabase Studio, then verified with a live query (Task 4). Re-read the SQL above and confirm: `is_platform_admin()` already exists in `supabase/migrations/20260916000004_platform_admin_users.sql`; the policy names are unique (don't collide with any existing policy name on `households` or `household_members` — the existing ones are `"households can be viewed by creator or member"` variants, `"any authenticated user can create a household"`, `"owners/admins can update household"`, `"only owner can delete household"` on `households`, and `"members can view membership roster"` plus the insert/update policies on `household_members`, all in `supabase/migrations/20260913000002_rls_policies.sql`); and that none of the three new policies has a `with check` clause (they're all `SELECT`/`DELETE`, which only take `using`).

- [ ] **Step 3: Confirm no `types.ts` change is needed**

No new tables, columns, or functions are introduced — only RLS policies, which the hand-maintained `packages/supabase-client/src/types.ts` doesn't represent at all (it only describes table/function shapes, not policies). Confirm this by re-reading `types.ts`'s `households` and `household_members` entries — nothing about them needs to change for this task.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260918000003_delete_household_admin.sql
git commit -m "feat(db): let platform admins view and delete any household"
```

- [ ] **Step 5: Flag the hand-off**

In your final report for this task, state clearly: *this migration is not yet applied to the live database* — the user needs to run it via Supabase Studio (SQL Editor, paste the file contents, run) before Task 4's live verification can happen. Tasks 2–3 do not require the live database (they're code + unit tests against a mocked client) and can proceed without waiting.

---

### Task 2: `packages/supabase-client` — `getHouseholdOwnedBy` and `deleteHousehold`

**Files:**
- Modify: `packages/supabase-client/src/platformAdmin.ts`
- Modify: `packages/supabase-client/src/platformAdmin.test.ts`

**Interfaces:**
- Consumes: the RLS policies from Task 1 (not directly testable here — the unit tests mock the client, matching how `grantAdmin`/`revokeAdmin`'s existing tests do).
- Produces (consumed by Task 3's `/admin/users` page): `interface HouseholdSummary { id: string; name: string; memberCount: number }`; `getHouseholdOwnedBy(client, userId: string): Promise<HouseholdSummary | null>`; `deleteHousehold(client, householdId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `packages/supabase-client/src/platformAdmin.test.ts`, change the top import from:

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

to:

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
  getHouseholdOwnedBy,
  deleteHousehold,
} from './platformAdmin';
```

Then add this new `describe` block at the end of the file, after the existing `describe('grantAdmin / revokeAdmin', ...)` block:

```ts
describe('getHouseholdOwnedBy / deleteHousehold', () => {
  function fakeClient(handlers: {
    householdResult?: { data: any; error: any };
    countResult?: { count: number | null; error: any };
    deleteResult?: { error: any };
  }) {
    const state: any = {};
    state.from = (table: string): any => {
      if (table === 'households') {
        return {
          select: () => ({
            eq: (...args: any[]) => {
              state.lastHouseholdEqArgs = args;
              return { maybeSingle: async () => handlers.householdResult };
            },
          }),
          delete: () => ({
            eq: (...args: any[]) => {
              state.lastDeleteEqArgs = args;
              return Promise.resolve(handlers.deleteResult);
            },
          }),
        };
      }
      if (table === 'household_members') {
        return {
          select: (columns: string, options: any) => {
            state.lastCountSelectColumns = columns;
            state.lastCountOptions = options;
            return {
              eq: (...args: any[]) => {
                state.lastCountEqArgs = args;
                return Promise.resolve(handlers.countResult);
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };
    return state as SupabaseClient<Database> & {
      lastHouseholdEqArgs?: any[];
      lastDeleteEqArgs?: any[];
      lastCountSelectColumns?: any;
      lastCountOptions?: any;
      lastCountEqArgs?: any[];
    };
  }

  describe('getHouseholdOwnedBy', () => {
    it('returns the household with its member count when found', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'The Santos Family' }, error: null },
        countResult: { count: 3, error: null },
      });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toEqual({
        id: 'house-1',
        name: 'The Santos Family',
        memberCount: 3,
      });
      expect(client.lastHouseholdEqArgs).toEqual(['created_by', 'user-1']);
      expect(client.lastCountEqArgs).toEqual(['household_id', 'house-1']);
      expect(client.lastCountOptions).toEqual({ count: 'exact', head: true });
    });

    it('returns null when the user owns no household', async () => {
      const client = fakeClient({ householdResult: { data: null, error: null } });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toBeNull();
    });

    it('defaults memberCount to 0 when count is null', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'Empty House' }, error: null },
        countResult: { count: null, error: null },
      });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toEqual({
        id: 'house-1',
        name: 'Empty House',
        memberCount: 0,
      });
    });

    it('throws when the household query errors', async () => {
      const client = fakeClient({ householdResult: { data: null, error: new Error('boom') } });
      await expect(getHouseholdOwnedBy(client, 'user-1')).rejects.toThrow('boom');
    });

    it('throws when the member count query errors', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'The Santos Family' }, error: null },
        countResult: { count: null, error: new Error('count failed') },
      });
      await expect(getHouseholdOwnedBy(client, 'user-1')).rejects.toThrow('count failed');
    });
  });

  describe('deleteHousehold', () => {
    it('deletes by household id', async () => {
      const client = fakeClient({ deleteResult: { error: null } });
      await deleteHousehold(client, 'house-1');
      expect(client.lastDeleteEqArgs).toEqual(['id', 'house-1']);
    });

    it('throws when the delete errors', async () => {
      const client = fakeClient({ deleteResult: { error: new Error('permission denied') } });
      await expect(deleteHousehold(client, 'house-1')).rejects.toThrow('permission denied');
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/supabase-client && npx jest platformAdmin.test.ts`
Expected: FAIL — `getHouseholdOwnedBy`/`deleteHousehold` are not exported by `./platformAdmin` (they don't exist yet).

- [ ] **Step 3: Write the implementation**

In `packages/supabase-client/src/platformAdmin.ts`, add this after the existing `revokeAdmin` function (at the end of the file):

```ts
export interface HouseholdSummary {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * Looks up the household a given user created, with its member count, for
 * the admin confirmation dialog before deleting it. Returns null if the
 * user doesn't currently own a household (e.g. it was already deleted by
 * someone else in a race) — the caller treats that as "nothing to delete,
 * just retry the user delete directly."
 */
export async function getHouseholdOwnedBy(
  client: SupabaseClient<Database>,
  userId: string
): Promise<HouseholdSummary | null> {
  const { data: household, error } = await client
    .from('households')
    .select('id, name')
    .eq('created_by', userId)
    .maybeSingle();
  if (error) throw error;
  if (!household) return null;

  const { count, error: countError } = await client
    .from('household_members')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', household.id);
  if (countError) throw countError;

  return { id: household.id, name: household.name, memberCount: count ?? 0 };
}

export async function deleteHousehold(client: SupabaseClient<Database>, householdId: string): Promise<void> {
  const { error } = await client.from('households').delete().eq('id', householdId);
  if (error) throw error;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/supabase-client && npx jest platformAdmin.test.ts`
Expected: PASS, all cases green (19 existing tests plus the 7 new ones — if the count differs, re-check nothing else in the file changed).

- [ ] **Step 5: Run the full package test suite and typecheck**

Run: `cd packages/supabase-client && npx jest && npx tsc --noEmit`
Expected: all suites PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/supabase-client/src/platformAdmin.ts packages/supabase-client/src/platformAdmin.test.ts
git commit -m "feat(supabase-client): add getHouseholdOwnedBy and deleteHousehold"
```

---

### Task 3: `apps/web` — "Delete household and retry" on `/admin/users`

**Files:**
- Modify: `apps/web/src/app/admin/users/page.tsx`

**Interfaces:**
- Consumes: `getHouseholdOwnedBy`, `deleteHousehold`, `type HouseholdSummary` (Task 2); `deleteUser`, `runUserAction`, `AdminUserRow`, `bulkUserBusy`, `userRowErrors`, `actionError`/`setActionError` (already exist on this page).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the new imports**

In `apps/web/src/app/admin/users/page.tsx`, change:

```tsx
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
  deleteUser,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
  type AdminUserRow,
  type AccessApplication,
} from '@pantry/supabase-client';
```

to:

```tsx
import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  grantAdmin,
  revokeAdmin,
  deleteUser,
  getHouseholdOwnedBy,
  deleteHousehold,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
  type AdminUserRow,
  type HouseholdSummary,
  type AccessApplication,
} from '@pantry/supabase-client';
```

- [ ] **Step 2: Add the handler**

Change:

```tsx
  async function handleDeleteSingle(user: AdminUserRow) {
    if (!window.confirm(`Delete ${user.email ?? 'this user'}? This cannot be undone.`)) return;
    await runUserAction([user.id], (id) => deleteUser(supabase, id));
  }

  if (authLoading || checkingAccess) return null;
```

to:

```tsx
  async function handleDeleteSingle(user: AdminUserRow) {
    if (!window.confirm(`Delete ${user.email ?? 'this user'}? This cannot be undone.`)) return;
    await runUserAction([user.id], (id) => deleteUser(supabase, id));
  }

  async function handleDeleteHouseholdAndRetry(user: AdminUserRow) {
    setActionError(null);
    let household: HouseholdSummary | null;
    try {
      household = await getHouseholdOwnedBy(supabase, user.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to look up household');
      return;
    }
    if (!household) {
      await runUserAction([user.id], (id) => deleteUser(supabase, id));
      return;
    }
    const memberWord = household.memberCount === 1 ? 'member' : 'members';
    const confirmed = window.confirm(
      `Delete household "${household.name}" (${household.memberCount} ${memberWord}) to unblock deleting ${user.email ?? 'this user'}? This cannot be undone.`
    );
    if (!confirmed) return;
    await runUserAction([user.id], async (id) => {
      await deleteHousehold(supabase, household.id);
      await deleteUser(supabase, id);
    });
  }

  if (authLoading || checkingAccess) return null;
```

- [ ] **Step 3: Add the button to the mobile card's error block**

Change:

```tsx
                {userRowErrors[user.id] && (
                  <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{userRowErrors[user.id]}</p>
                )}
```

to:

```tsx
                {userRowErrors[user.id] && (
                  <>
                    <p style={{ color: color.destructive, fontSize: 13, margin: 0 }}>{userRowErrors[user.id]}</p>
                    {userRowErrors[user.id].includes('created a household') && (
                      <button
                        onClick={() => handleDeleteHouseholdAndRetry(user)}
                        disabled={bulkUserBusy}
                        style={buttonStyle('danger')}
                      >
                        Delete household and retry
                      </button>
                    )}
                  </>
                )}
```

- [ ] **Step 4: Add the button to the desktop table's error cell**

Change:

```tsx
                        {userRowErrors[user.id] && (
                          <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{userRowErrors[user.id]}</p>
                        )}
```

to:

```tsx
                        {userRowErrors[user.id] && (
                          <>
                            <p style={{ color: color.destructive, fontSize: 12, margin: 0 }}>{userRowErrors[user.id]}</p>
                            {userRowErrors[user.id].includes('created a household') && (
                              <button
                                onClick={() => handleDeleteHouseholdAndRetry(user)}
                                disabled={bulkUserBusy}
                                style={{ ...buttonStyle('danger'), fontSize: 12 }}
                              >
                                Delete household and retry
                              </button>
                            )}
                          </>
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
git add apps/web/src/app/admin/users/page.tsx
git commit -m "feat(web): add delete-household-and-retry to the admin users page"
```

---

### Task 4: Live verification (after the user applies Task 1's migration)

**Files:** none — verification only, no code changes expected unless a live-only bug surfaces.

**Interfaces:**
- Consumes: everything from Tasks 1–3, live.

- [ ] **Step 1: Confirm the migration landed and verify RLS directly**

Ask the user to confirm they've run `supabase/migrations/20260918000003_delete_household_admin.sql` via Supabase Studio. Then verify directly (via Supabase Studio's SQL editor run as different roles, or `curl` against the REST endpoint with different users' access tokens):
1. A non-admin user cannot `select` a household they don't belong to.
2. A non-admin user cannot `delete` a household they don't belong to (own-household deletion via the pre-existing owner policy should still work for an actual `OWNER`, unaffected by this change).
3. A platform admin can `select` an arbitrary household by id and its member count via `household_members`.
4. A platform admin can `delete` an arbitrary household, and it cascades away its `household_members`/`pantry_items`/etc. rows.

- [ ] **Step 2: Live check of the actual motivating scenario**

Using the `run-web` pattern:
1. Create a throwaway account, sign in as it, and have it create a household (so it becomes a real `households.created_by`).
2. From `/admin/users` (signed in as `ronnel.go@gmail.com`), attempt to delete that throwaway account and confirm the existing "This user created a household..." message still appears, now with a "Delete household and retry" button beneath it.
3. Click it and confirm the `window.confirm` dialog names the correct household and member count.
4. Accept it, and confirm: the household and the user account are both gone, the row disappears from the user list after the automatic refresh, and no residual error is shown.
5. Repeat the scenario but decline the `window.confirm` — confirm nothing happens (no household deleted, no user deleted, the original error message still shown).

- [ ] **Step 3: Report results**

Summarize what passed, what (if anything) needed a live-only fix, and confirm the feature is ready to use.
