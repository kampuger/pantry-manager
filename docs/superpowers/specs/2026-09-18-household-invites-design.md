# Household Invites: Join an Existing Household

Status: Approved for planning
Date: 2026-09-18

## Problem

Today, `packages/supabase-client/src/household.ts` only exports `createHousehold`; `apps/web/src/lib/useHousehold.ts`'s only fallback for a signed-in user with no household is `CreateHouseholdPrompt`, which always creates a brand-new household. There is no way for a second person to become a member of an *existing* household — `household_members` already models multiple members with roles (`OWNER`/`ADMIN`/`MEMBER`), but nothing in the UI or `packages/supabase-client` lets anyone but the original creator populate it.

This forces every single new user — including everyone who comes in through the just-shipped access-applications-approval-queue feature — to become the `created_by` owner of their own isolated household. That's also why `households.created_by ... on delete restrict` blocks admin deletion for nearly every real test account: there is currently no path that leads anywhere else.

This spec adds the missing piece: a household owner or admin can generate a shareable, single-use invite code. A new user can redeem it two ways — self-serve, from the same screen that currently only offers "create a household," or transparently on their first login if they supplied the code back when they applied for platform access.

## Non-goals

- No UI for reassigning or deleting an *existing* household to unblock a stuck `delete_user` call — that remains the access-applications spec's own explicit Non-goal. This spec is preventive (new users get a way to avoid becoming isolated owners in the first place), not remedial.
- No dedicated household-settings page or route. The invite-generation UI is a small addition to the existing home page, gated on the signed-in user's role in their current household.
- No list/management UI for previously-generated codes, no revoke action. An owner/admin generates a code, shares it, and it either gets used or expires — that's the whole lifecycle for now.
- No email delivery of invite codes. The code is a short, human-readable string the owner copies and shares out-of-band (text, chat, in person) — no new email-sending mechanism is introduced.
- No cleanup job for expired/used invite rows. They stay in `household_invites` permanently, matching the same "keep history, no DELETE policy" pattern already established for `access_applications`.
- No change to `access_applications`' approval/rejection logic itself, or to the two-call approve pattern — this spec only adds one nullable column to that table and one new SELECT policy for the applicant to read their own row back.
- No enforcement, anywhere in the database, of "one household per user" — none exists today either (it's an implicit UI convention, not a constraint), and this spec doesn't change that. Redemption is gated in the UI (the option only appears when the user has no household), matching how `createHousehold` is gated today.
- `apps/mobile` is untouched — mobile work is paused per current direction; this is web-only, matching the access-applications feature's own scope decision.

## Current state (for reference)

- `packages/supabase-client/src/household.ts`: `createHousehold(client, userId, name): Promise<HouseholdMembership>` inserts a `households` row (`created_by: userId`) then a `household_members` row (`role: 'OWNER'`). `getMyHousehold(client, userId): Promise<HouseholdMembership | null>` reads the caller's own single membership row.
- `apps/web/src/lib/useHousehold.ts`: `useHousehold()` returns `{ membership, create }`, where `membership` is `'loading' | null | HouseholdMembership`. Every consumer (`apps/web/src/app/page.tsx`, `pantry`, `recipe`, `shopping-list`) renders `<CreateHouseholdPrompt onCreate={create} />` whenever `membership === null` — the single shared "no household yet" component, defined in `apps/web/src/components/CreateHouseholdPrompt.tsx`.
- `household_members` (`20260913000001_initial_schema.sql:44-51`): `id, household_id, user_id, role ('OWNER'|'ADMIN'|'MEMBER'), joined_at`, unique `(household_id, user_id)`.
- Existing RLS helpers, both `security definer` (`20260913000002_rls_policies.sql:4-31`): `is_household_member(household_id)` and `is_household_admin_or_owner(household_id)` — this spec's new policies and function reuse these directly, no new helper needed.
- The existing "owners/admins can add members" INSERT policy on `household_members` (`20260913000002_rls_policies.sql:79-81`) requires the caller to already be an owner/admin AND to already know the invitee's `user_id` — unusable for inviting someone who hasn't signed up yet, which is exactly the access-application use case this spec needs to support.
- `access_applications` (from the access-applications-approval-queue feature, `20260918000001_access_applications.sql`): `id, email, message, status, submitted_at, reviewed_at, reviewed_by`. Its only SELECT policy today is `"admins can read applications" using (is_platform_admin())` — a non-admin applicant cannot read their own row, which this spec needs for the auto-redeem-on-first-login flow.
- `apps/web/src/app/login/page.tsx`'s `apply` mode: Email + optional message fields, calls `submitApplication(supabase, email, message)`.

## Data model changes

New migration:

```sql
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

create or replace function redeem_household_invite(invite_code text)
returns uuid  -- the joined household_id
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

alter table access_applications add column household_invite_code text;

create policy "applicants can read their own application"
  on access_applications for select
  using (email = auth.email());
```

- No public SELECT policy on `household_invites` at all — a code is only ever checked by calling `redeem_household_invite`, never by reading the table directly, so one household's codes can never be enumerated from outside it.
- The atomic `update ... where used_at is null and expires_at > now() ... returning` is what makes redemption race-safe: if two people submit the same code at once, only one `update` can affect a row: the other gets `v_household_id is null` and the clean "invalid, expired, or already used" error.
- `redeem_household_invite` is `security definer` so it can write `household_members` on the caller's behalf, but it only ever inserts `auth.uid()` — there is no way to use it to add anyone else. If the caller happens to already be a member of the target household (redeeming by mistake), the existing `household_members` unique `(household_id, user_id)` constraint raises a normal, expected error — no special-casing added for it.
- `created_by`/`used_by` use `on delete cascade`/`on delete set null` respectively, matching this project's now-established convention (from the access-applications final review) that a "who touched this row" foreign key should never turn into an unrelated deletion blocker for an otherwise-unrelated user.
- `access_applications.household_invite_code` is nullable, unvalidated text — it commemorates what the applicant typed at submission time, not a live foreign key; validity is only checked at actual redemption time.
- The new `"applicants can read their own application"` policy relies on `auth.email()` (from the caller's own JWT, not client-supplied input) matching the row's `email` column — safe because `inviteUserByEmail(application.email)` (existing, unchanged) creates the invited account with that exact email, so once the applicant signs in for the first time, `auth.email()` reliably matches their own application row and no one else's.

Regenerate `packages/supabase-client/src/types.ts`: add the `household_invites` table, the `access_applications.household_invite_code` column, and the `redeem_household_invite` function, following the existing patterns.

## `packages/supabase-client` additions

Modify `packages/supabase-client/src/household.ts` — add one export alongside the existing `createHousehold`:

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

- Returns the same `HouseholdMembership` shape `createHousehold` does, so `useHousehold`'s state update is identical either way — the caller doesn't need to know which path was taken.
- Throws directly on error; the RPC's own `raise exception` message ("This invite code is invalid, expired, or already used.") surfaces through supabase-js's RPC error path unchanged, same convention as `checkIsPlatformAdmin`.

New file `packages/supabase-client/src/householdInvites.ts`:

```ts
export interface HouseholdInvite {
  id: string;
  code: string;
  expiresAt: string;
}

export async function createHouseholdInvite(
  client: SupabaseClient<Database>,
  householdId: string,
  createdBy: string
): Promise<HouseholdInvite>;
```

- Generates an 8-character code client-side by drawing from the fixed charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase alphanumeric, with `0`/`O`/`1`/`I` excluded to avoid visual ambiguity) — matches this codebase's preference for plain, human-typeable values over opaque identifiers wherever a person reads or types one. Inserts `{ household_id: householdId, code, created_by: createdBy }`, selects back `id, code, expires_at`, and returns it. On the (extremely unlikely) chance of a code collision against the table's `unique` constraint, the insert fails and the caller sees a normal "try again" error — no retry loop is added for this.

Modify `packages/supabase-client/src/accessApplications.ts`:

- `submitApplication(client, email, message?, householdInviteCode?)` — one new optional third parameter (note: this shifts `message` and adds a new param after it; existing call sites pass `message` positionally and continue to work since the new parameter is appended, not inserted). Inserted as `household_invite_code: householdInviteCode?.trim() || null` alongside the existing `email`/`message` fields.
- New export:

```ts
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

- Filters `status = 'approved'` and orders by most-recent-reviewed so a user who (unusually) has more than one historical application row still gets a sensible single answer. Relies on the new `"applicants can read their own application"` RLS policy — the caller passes their own `session.user.email`, and RLS independently enforces that they can only ever see rows matching their own authenticated email regardless of what's passed in.

## `apps/web` changes

### `useHousehold.ts` — auto-redeem on first login

The effect that currently does `getMyHousehold(...).then(setMembership)` is extended: when `getMyHousehold` returns `null` (no household yet), before showing the create/join prompt, check whether this user's own approved application carried an invite code, and if so, redeem it transparently:

```ts
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
      // Invalid, expired, or already-used code, or the lookup itself failed —
      // fall through to the normal create-or-join prompt rather than
      // blocking the user on a code they don't control.
    }
    if (!cancelled) setMembership(null);
  })();

  return () => {
    cancelled = true;
  };
}, [session]);
```

- `create` stays exactly as it is today. A new `join` callback is added alongside it, calling `redeemHouseholdInvite` and updating `membership` the same way `create` does — this is what the manual code-entry path (below) calls.

### `CreateHouseholdPrompt.tsx` — add a "have a code" alternative

The component gains a `mode: 'create' | 'join'` toggle and an `onJoin: (code: string) => Promise<unknown>` prop alongside the existing `onCreate`. A small text link under the existing form ("Have an invite code instead?") switches `mode` to `'join'`, swapping the "Household name" field for a "Invite code" field and the submit label to "Join household." Before calling `onJoin`, the typed code is trimmed and uppercased (`code.trim().toUpperCase()`) — generated codes are always uppercase, so this means a lowercase-typed code still matches without the user needing to notice case. Both modes share the same submitting/error state handling already in the component — no structural rewrite, just a second branch through the existing `handleSubmit`.

### Home page — generate an invite code

`apps/web/src/app/page.tsx` gains a small "Invite a member" affordance in the header area, shown only when `membership !== null && membership !== 'loading'` and `membership.role === 'OWNER' || membership.role === 'ADMIN'` (matches the RLS policy exactly — a plain `MEMBER` never sees this). Clicking it reveals an inline panel with a "Generate code" button; on click, calls `createHouseholdInvite(supabase, membership.householdId, session.user.id)` and displays the resulting code in a monospace box with a copy-to-clipboard button and its expiry date ("Expires Sep 25, 2026"). No persistent list of past codes — generating a new one is just a fresh call, and the previous code (if unused) simply continues to exist until it expires or is redeemed, unaffected.

### Login page — optional invite code on the apply form

`apps/web/src/app/login/page.tsx`'s `apply` mode gains one more optional field, "Household invite code (optional)," alongside the existing message textarea. `handleSubmit`'s `submitApplication` call passes it through as the new fourth argument. The confirmation panel text is unchanged — the applicant doesn't need to know whether their code will "arrive" until they actually log in and it's silently redeemed (or silently ignored, if it's already invalid by then; see Error handling).

## Error handling

- `redeem_household_invite`'s single `raise exception` covers every failure mode (not found, expired, already used) with one clear message — no need to distinguish them further for the user, since the remedy is the same either way: ask whoever generated the code for a new one.
- The auto-redeem path in `useHousehold.ts` treats any redemption failure as equivalent to "no code was given" — it never surfaces the RPC's error message to a user who didn't type anything themselves; they just land on the normal create/join prompt. Surfacing a scary error message about a code they never typed, on their very first login, would be confusing rather than helpful.
- The manual join path (through `CreateHouseholdPrompt`'s `'join'` mode) does surface the error, using the exact same inline-error pattern the component already uses for `onCreate` failures.
- `createHouseholdInvite`'s unique-constraint collision (vanishingly unlikely at 8 characters excluding ambiguous ones) surfaces as a normal thrown error the invite-generation panel displays inline — no retry loop.

## Testing

- Unit tests for `redeemHouseholdInvite` and `createHouseholdInvite` (`packages/supabase-client/src/household.test.ts` and `householdInvites.test.ts`), mocking the client the same way `platformAdmin.test.ts`/`accessApplications.test.ts` already do — including a specific test that `redeemHouseholdInvite` throws with the RPC's exact error message on failure, and that it returns `{ householdId, role: 'MEMBER' }` on success.
- Unit tests for `submitApplication`'s new optional parameter (defaults to `null` when omitted, trimmed like `message`) and `getMyApplicationInviteCode` (returns `null` when no approved row matches, returns the code when one does, orders by most-recent when several exist).
- Manual RLS verification once the migration is applied: confirm a non-owner/non-admin household member cannot INSERT into `household_invites`; confirm a user cannot SELECT another household's invites; confirm an applicant can SELECT their own `access_applications` row by email but not anyone else's; confirm the redeem RPC's race-safety by attempting two rapid redemptions of the same code and observing exactly one success.
- Live check (`run-web` pattern): as an existing household owner, generate an invite code; as a second, fresh throwaway account with no household, redeem it via the manual "join" flow and confirm they land in the same household as a `MEMBER`; separately, submit an application with an invite code attached, have an admin approve it, sign in as that (now-invited) throwaway account for the first time, and confirm they land directly in the inviting household with no create/join prompt shown at all.
