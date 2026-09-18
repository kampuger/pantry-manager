# Delete Household (Admin)

Status: Approved for planning
Date: 2026-09-18

## Problem

`households.created_by ... on delete restrict` blocks `admin-manage-users`' `delete_user` action for any account that created a household — the Edge Function proactively detects this and returns a clear message, but there is no remedy anywhere in the app: an admin who hits it is stuck. In practice this makes routine cleanup of throwaway/test accounts impossible without going into Supabase Studio and manually deleting rows.

This spec adds the missing remedy: a platform admin can delete the blocking household directly from `/admin/users`, right where the error already appears, and have the user deletion retried automatically in the same action.

## Non-goals

- No self-service deletion by the household owner from within the app itself. `households` already has a DB-level policy letting an `OWNER` delete their own household (`"only owner can delete household"`, `20260913000002_rls_policies.sql:63-70`) — nothing in this spec touches that, but no UI is added for it either. This spec is admin-only, matching the pain point (an admin cleaning up other people's stuck accounts), not a general household-management feature.
- No standalone "browse all households" admin view or list page. The action lives only inline on the existing delete-user failure — an admin who hasn't hit that failure has no reason to browse households from here.
- No richer pre-delete preview (pantry item counts, financial data, etc.) — just the household's name and member count, enough to stop an accidental click without building a dedicated data-impact report.
- No undo, soft-delete, or archive state — matches this project's existing `deleteUser` precedent exactly: immediate and permanent, with a `window.confirm(...)` as the only safety net.
- No change to `admin-manage-users`' `delete_user` action or its proactive households-created_by check — the exact error message it returns today stays unchanged; this spec only adds something to do in response to it.
- `apps/mobile` is untouched — mobile work is paused per current direction, matching every other recent web-only feature in this project.

## Current state (for reference)

- `supabase/functions/admin-manage-users/index.ts:135-173`: `delete_user` proactively checks `households` for any row where `created_by = targetUserId` before attempting `admin.auth.admin.deleteUser(targetUserId)`. If found, it returns `{ status: 'error', message: "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again." }` without attempting the delete at all.
- `packages/supabase-client/src/platformAdmin.ts`: `deleteUser(client, targetUserId)` invokes that action and throws with the server's message on failure. `grantAdmin`/`revokeAdmin` (`:88-100`) are the precedent for an admin action that is a *plain RLS-gated table write*, needing no Edge Function/service-role access at all — `deleteHousehold` below follows that same shape.
- `households` RLS (`20260913000002_rls_policies.sql:50-70`): SELECT is `created_by = auth.uid() or is_household_member(id)`; DELETE is restricted to a caller who is an `OWNER` member of that specific household. Neither lets a platform admin who is neither the creator nor a member act on an arbitrary household — this spec adds new, additional policies (permissive policies on the same table+command combine with `OR` in Postgres, so nothing existing is narrowed).
- `household_members` RLS: SELECT is `is_household_member(household_id)` — same gap, needed to read a member count for a household the admin doesn't belong to.
- `apps/web/src/app/admin/users/page.tsx`: `userRowErrors: Record<string, string>` already holds one error string per user row (set by `runUserAction`'s per-item-isolated loop, `:227-241`), rendered identically in both the mobile card list (`:501-503`) and the desktop table (`:588-590`). `handleDeleteSingle`/`handleBulkDelete` already establish the pattern of a `window.confirm(...)` immediately before calling `deleteUser` through `runUserAction`.

## Data model changes

New migration, additive only (no existing policy is modified or removed):

```sql
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

- `is_platform_admin()` already exists (`20260916000004_platform_admin_users.sql`) and is already used this way for `access_applications`' admin-only SELECT/UPDATE policies — no new helper function needed.
- The existing owner-only DELETE policy on `households` is untouched; an admin's delete and an owner's own self-delete both remain possible, independently, through their own respective policies.
- No new table, no new column. Deleting a household still cascades through every table that references `household_id` with `on delete cascade` (already true today, unrelated to this spec) — `household_members`, `pantry_items`, `household_invites`, etc. all disappear with it.
- Regenerate `packages/supabase-client/src/types.ts`: no changes needed — no new tables, columns, or functions, only RLS policies, which aren't represented in the hand-maintained `Database` type.

## `packages/supabase-client` additions

New exports in `packages/supabase-client/src/platformAdmin.ts` (alongside `grantAdmin`/`revokeAdmin`, the closest existing precedent — a plain RLS-gated write, no Edge Function):

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

- Both functions rely entirely on RLS for authorization, exactly like `grantAdmin`/`revokeAdmin` — no client-side admin check, no Edge Function round-trip. A non-admin calling either gets a normal Postgrest permission-denied error (SELECT/DELETE simply match zero rows or are rejected, depending on the policy), same failure shape this codebase already treats as normal elsewhere.
- `getHouseholdOwnedBy` returning `null` is not an error — it's the expected outcome of the race described in its docstring, and the UI treats it as "proceed straight to retrying the user delete."

## `apps/web` changes

### `/admin/users` — "Delete household and retry"

`apps/web/src/app/admin/users/page.tsx`'s existing import from `@pantry/supabase-client` (`:5-19`) gains three names: `getHouseholdOwnedBy`, `deleteHousehold`, `type HouseholdSummary`.

The page gains one new handler:

```tsx
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
```

- Reuses `runUserAction` exactly as-is (`:227-241`) — its existing per-item-isolated try/catch, `bulkUserBusy` flag, `userRowErrors` write, and `refreshUsers()` call all apply unchanged. If `deleteHousehold` throws, that becomes the new `userRowErrors[user.id]` message (replacing the households-restrict message); if it succeeds but the retried `deleteUser` then fails for some unrelated reason, that failure is what's shown instead — both are the same "one error message per row" behavior every other action on this page already has.
- The initial `getHouseholdOwnedBy` lookup is wrapped in its own `try/catch` writing to the existing page-level `actionError` state (`:67`, already rendered via `<AlertBanner tone="destructive">{actionError}</AlertBanner>` at `:474`) — this matches `handleToggleSuspend`/`handleToggleAdmin` (`:128-155`), the existing precedent for a one-off action outside `runUserAction`'s per-row loop, rather than leaving a lookup failure as an unhandled rejection. The `window.confirm` and everything after it still happens exactly like `handleDeleteSingle`'s existing pattern (`:258-261`) — no new busy-state plumbing needed for the lookup step itself.

Rendering: in both the mobile card list and the desktop table, wherever `userRowErrors[user.id]` is already shown, add a conditional button directly beneath it — detected purely by checking the message text for the phrase the Edge Function is already known to return, no new state field:

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

This replaces the current bare `{userRowErrors[user.id] && <p>...</p>}` block in both the mobile template (`:501-503`) and the desktop table cell (`:588-590`) — same conditional, wrapped to add the extra button underneath when applicable.

## Error handling

- `getHouseholdOwnedBy` throwing (a genuine DB/network error, not "no household found") is caught in `handleDeleteHouseholdAndRetry` and written to the page-level `actionError` state, matching `handleToggleSuspend`/`handleToggleAdmin` — the existing precedent for a one-off action's failure that isn't part of `runUserAction`'s per-row loop.
- Every failure *inside* `runUserAction`'s callback (`deleteHousehold` or the retried `deleteUser`) is caught and shown inline in `userRowErrors[user.id]` exactly like every other action on this page — no new error-handling pattern introduced.
- Declining the `window.confirm` is a silent no-op, matching `handleDeleteSingle`/`handleBulkDelete` exactly.

## Testing

- Unit tests for `getHouseholdOwnedBy` and `deleteHousehold` in `packages/supabase-client/src/platformAdmin.test.ts`, mocking the client the same way `grantAdmin`/`revokeAdmin`'s existing tests do (a fake `.from(...)` chain, no Edge Function involved) — covering: `getHouseholdOwnedBy` returns the mapped `{id, name, memberCount}` when a household exists, returns `null` when the user owns no household, and throws when either query errors; `deleteHousehold` throws when the delete errors and resolves otherwise.
- Manual RLS verification once the migration is applied: confirm a non-admin cannot `select` or `delete` a household they don't belong to; confirm a platform admin can `select` an arbitrary household and its member count, and can `delete` it.
- Live check (`run-web` pattern): reproduce the actual motivating scenario — create a throwaway account, have it create a household, attempt to delete that account from `/admin/users` and confirm the existing error appears, click "Delete household and retry," confirm the dialog shows the correct household name and member count, confirm on accepting both the household and the user account are gone and the list refreshes correctly.
