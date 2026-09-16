# Platform Admin: User Management (Invite / Suspend / Promote)

Status: Approved for planning
Date: 2026-09-16

## Problem

There is no way for anyone to see the full list of people who've signed up,
invite a new person directly, or lock someone out of the app. The only
existing notion of privilege is `household_members.role`
(`OWNER`/`ADMIN`/`MEMBER`), which is scoped to a single household and
controls nothing outside it. This spec adds a separate, app-wide admin role
with a screen to invite, suspend/unsuspend, and promote/demote users —
independent of and unrelated to household roles.

## Non-goals

- Any change to household roles (`OWNER`/`ADMIN`/`MEMBER`) or their existing
  RLS policies. Platform admin is a wholly separate axis of privilege.
- Editing a user's profile (name, email, password) from the admin screen.
  Only invite / suspend / unsuspend / promote / demote.
- An audit log UI. `platform_admins.granted_by` records who promoted whom,
  but there's no screen to browse suspension/invite history in this pass.
- `apps/mobile` (the React Native app). Web only — an admin tool used
  rarely, by one person, doesn't need a native screen yet. Can be ported
  later the same way other features were. (Not to be confused with the web
  app's own mobile-*browser-width* responsive layout, which this feature
  still has to work within — see UI section.)
- Any password-based account creation. "Add user" only ever sends an
  invite email; nobody but the invited person ever sets their password.

## Current state (for reference)

- `household_members`: `household_id, user_id, role (OWNER/ADMIN/MEMBER),
  notifications_enabled, joined_at`. Scoped per household; irrelevant to
  this feature except as a reminder that this is a *different* role axis.
- `is_household_member(household_id)` / `is_household_admin_or_owner
  (household_id)` (`20260913000002_rls_policies.sql`): `security definer`
  SQL functions used throughout existing RLS policies — this spec follows
  the same pattern for its own admin check.
- `supabase/functions/compute-and-send-reminders/index.ts`: the one
  existing Edge Function. Established pattern this spec reuses directly:
  decode the caller's JWT from the `Authorization` header, branch on
  `service_role` vs. `authenticated`, look up the caller's privilege from
  the database via a service-role admin client, reject with 401/403 if it
  doesn't check out, otherwise perform the privileged action.
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are already configured as
  Edge Function secrets in this project (set up for that function) — no new
  secrets needed.
- `apps/web/src/components/Sidebar.tsx` / `MobileNav.tsx` /
  `navItems.tsx`: the web nav item list (`NAV_ITEMS`) and rendering are
  already split apart (`navItems.tsx` holds the shared icon+label+href
  list). This spec adds a 6th item, conditionally rendered.
- No `profiles` table or any other app-level per-user table exists yet —
  the only per-user data outside `auth.users` is `household_members` rows.

## Data model changes

New migration (`supabase/migrations/20260916000004_platform_admin_users.sql`):

```sql
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

create policy "admins can read the admin list"
  on platform_admins for select
  using (is_platform_admin());

create policy "admins can promote other users"
  on platform_admins for insert
  with check (is_platform_admin());

create policy "admins can demote other admins"
  on platform_admins for delete
  using (is_platform_admin());

-- Prevents the panel from ever locking everyone out.
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

-- Seed the first admin. Run once; safe to leave in the migration since a
-- re-run just no-ops on the primary key conflict.
insert into platform_admins (user_id, granted_by)
select id, id from auth.users where email = 'ronnel.go@gmail.com'
on conflict (user_id) do nothing;
```

`is_platform_admin()` is callable from both RLS policies (as above) and
directly from client queries (`supabase.rpc('is_platform_admin')`) to drive
the UI's own "am I an admin" check and the conditional nav item — same
dual-use pattern as `is_household_member`.

Regenerate the hand-maintained `Database` type
(`packages/supabase-client/src/types.ts`) to add the `platform_admins`
table and the `is_platform_admin` function signature, following the
existing pattern for every other table/function in that file.

## Edge Function: `admin-manage-users`

New function at `supabase/functions/admin-manage-users/index.ts`, structured
like `compute-and-send-reminders`: CORS headers, JWT decode, then a single
admin-only check before branching on an `action` field in the JSON body.

```
POST body: { action: 'list_users' | 'invite_user' | 'suspend_user' | 'unsuspend_user', ... }
```

1. Reject non-POST and malformed-body requests (400), same as the existing
   function.
2. Decode the caller's JWT. This function has no `service_role` calling
   path (unlike the reminders function, which is also invoked by
   `pg_cron`) — every call originates from an authenticated browser
   session, so a bare 401 on a missing/invalid `Authorization` header is
   sufficient; no bearer-token branch needed.
3. Create a service-role admin client, look up the caller's id via
   `admin.auth.getUser(token)`, then query `platform_admins` for that id
   (service-role client, bypasses RLS — this is the actual authorization
   check other than a self-referential RLS read of the same table). If no
   row, return 403 `Forbidden: platform admin access required` and stop.
4. Branch on `action`:
   - **`list_users`**: `admin.auth.admin.listUsers()` (paginate if
     `> 1` page — start at `perPage: 200`, loop `page` until a short page
     comes back; a household app's total user count won't need more than a
     couple of pages for a long while, but the loop costs nothing to write
     correctly now). For each returned user, also note whether they appear
     in `platform_admins` (one query, `user_id in (...)`) so the response
     carries `{ id, email, createdAt, bannedUntil, isAdmin }[]` — the UI
     needs no second round trip to color badges.
   - **`invite_user`**: body also carries `email`. Reject if missing/not
     email-shaped (400). Call `admin.auth.admin.inviteUserByEmail(email)`.
     Surface Supabase's own error message on failure (e.g. already
     registered) rather than a generic one.
   - **`suspend_user`** / **`unsuspend_user`**: body also carries
     `targetUserId`. Reject if `targetUserId === caller's own id` (400,
     "cannot suspend your own account") — this is checked here, not only
     hidden client-side, since the edge function is the actual authority.
     Call `admin.auth.admin.updateUserById(targetUserId, { ban_duration:
     suspend ? '876000h' : 'none' })` (~100 years — Supabase has no literal
     "forever", so this is the established convention for an effectively
     permanent ban; unsuspending is just setting it back to `'none'`).
5. Every branch returns `{ status: 'ok', ...actionSpecificPayload }` on
   success (200) or `{ status: 'error', message }` on a handled failure
   (4xx) — the Edge Function never lets an unhandled exception escape
   without at least a 500 with a message, matching the reminders
   function's try/catch-per-recipient philosophy of never taking the whole
   request down over one bad input.

Promote/demote (adding/removing a `platform_admins` row) does **not** go
through this function — see Data model changes above; it's a direct,
RLS-gated table write from the client, since it needs no Auth Admin API
access. The one exception the RLS policies can't express on their own:
"can't remove the last admin" (the trigger handles that) and "should an
admin be able to demote themselves if they're not the last one" — yes,
allowed; it's their own privilege to give up, and the trigger still
protects against zeroing out the table entirely.

## `packages/supabase-client` additions

New file `packages/supabase-client/src/platformAdmin.ts`, following the
existing module-per-concern layout (`pantry.ts`, `household.ts`, etc.):

```ts
export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  bannedUntil: string | null; // null/past = active, future = suspended
  isAdmin: boolean;
}

export async function checkIsPlatformAdmin(client): Promise<boolean>;
export async function listAllUsers(client): Promise<AdminUserRow[]>;       // invokes admin-manage-users
export async function inviteUser(client, email: string): Promise<void>;    // invokes admin-manage-users
export async function suspendUser(client, targetUserId: string): Promise<void>;   // invokes admin-manage-users
export async function unsuspendUser(client, targetUserId: string): Promise<void>; // invokes admin-manage-users
export async function grantAdmin(client, targetUserId: string): Promise<void>;    // direct insert
export async function revokeAdmin(client, targetUserId: string): Promise<void>;   // direct delete
```

`bannedUntil` is what Supabase's Admin API actually returns per-user
(`banned_until`) — the UI derives an Active/Suspended badge by comparing it
to "now" rather than the function inventing its own status enum.

## UI: `/admin/users` (web)

New route `apps/web/src/app/admin/users/page.tsx`. On mount, calls
`checkIsPlatformAdmin`; while that's resolving, render nothing (matching
the existing `authLoading` pattern on other pages); if it resolves false,
render a plain "You don't have access to this page." message (not a
redirect — a bookmarked/typed URL should explain itself rather than
silently bounce) rather than the actual content.

Once confirmed admin:

- **Invite form**: a single email input + "Send invite" button, inline
  success ("Invite sent to \<email\>") or error state — same visual
  language as the existing `CreateHouseholdPrompt`/`NotificationPrefsModal`
  forms (`inputStyle`, `buttonStyle('primary')`, error text in
  `color.destructive`).
- **User table**: columns Email, Status (Active/Suspended badge, reusing
  `badgeStyle('success'|'destructive')`), Admin (a badge if `isAdmin`),
  Joined (formatted date), and a per-row actions cell: Suspend/Unsuspend
  button, Make admin/Remove admin button. Disabled + tooltip-via-`title`
  attribute on "Remove admin" for the row matching the signed-in admin's
  own id ("You can't remove your own admin access from here" — client-side
  hint; the trigger is the actual enforcement for the last-admin case, this
  is just why *your own* row specifically is disabled even when you're not
  the last one, which the trigger alone wouldn't explain).
- Follows the mobile-responsiveness pattern established for Financials/
  BulkAddModal: the table becomes a stacked card list under `useIsMobile()`
  (this page is desktop-primary, but the app shell itself doesn't
  distinguish route-by-route, so a signed-in admin opening it on a phone
  browser must not hit the same clipped-table bug fixed there).

**Nav integration**: `navItems.tsx`'s `NAV_ITEMS` stays exactly as-is
(those 5 items render unconditionally for every signed-in user, admin or
not — that list has no concept of "conditional"). `Sidebar.tsx` and
`MobileNav.tsx` each separately render one extra "Admin" link/dropdown-item
(reusing the same icon-svg style as the existing items) after checking
`checkIsPlatformAdmin` themselves, exactly mirroring how they already
independently check `session`/`membership` today — no shared "is admin"
context/provider needed for a single boolean read on mount.

## Error handling

- Edge Function: every failure path returns a JSON body with `message`
  (never a bare non-2xx with no body) so the client can show it directly,
  matching `NotificationPrefsModal`'s existing `catch (err) ->
  err.message` display convention.
- Client-side: `inviteUser`/`suspendUser`/etc. throw on a non-ok response
  (same `if (error) throw error` shape as every other `supabase-client`
  function) — the page's own try/catch sets an inline error banner, no
  silent failures.
- The last-admin and self-suspend/self-demote guards are enforced at the
  data layer (Postgres trigger, Edge Function check) specifically so they
  hold even if the UI's own disabled-button logic is ever wrong or bypassed
  — the UI hints are a courtesy, not the actual guarantee.

## Testing

- Unit tests for `packages/supabase-client/src/platformAdmin.ts`, mocking
  `client.functions.invoke` and `client.from('platform_admins')`/
  `client.rpc`, matching the existing `pantry.test.ts` fake-client pattern
  (verify the right `action` payload is sent for each function, the right
  table/method for grant/revoke, and that a non-ok response throws with
  the server's message).
- Manual verification of the migration and Edge Function against the live
  Supabase project once applied: confirm the seed admin row exists, invoke
  `admin-manage-users` directly (authenticated as the seed admin) for each
  action, and confirm a non-admin caller gets 403 on all of them.
- Live Playwright check (`run-web` pattern): sign in as the seed admin,
  confirm the "Admin" nav link appears and `/admin/users` lists at least
  the seed account; sign in as a freshly-created non-admin test account,
  confirm the nav link is absent and the route shows the access-denied
  message; back as the admin, invite a `kampuger+admintest<tag>@gmail.com`
  address, confirm it appears in the list, suspend it, confirm
  `bannedUntil` flips the badge, then clean up (delete the test household/
  membership rows the usual way — the invited-but-unconfirmed auth user
  itself is left behind per this session's established convention, same as
  every other throwaway test account).
