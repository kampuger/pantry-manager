# Access Applications & User Management: Apply-for-Access, Approval Queue, Delete + Bulk Actions

Status: Approved for planning
Date: 2026-09-16 (amended same day, before implementation, to add Delete
user and bulk actions on the existing user table — user table Delete/bulk
were not in the original scope; everything else in this document is
unchanged from the first draft)

## Problem

Today, anyone can create a real, immediately-usable account by using the
login page's "Sign up" mode — it calls `supabase.auth.signUp()` directly,
with no gate of any kind. This is the only way a new user gets in, aside
from an admin-initiated invite (the platform admin feature shipped just
before this spec).

Going forward, every new user should go through admin review before they
get access: they submit a request, see an acknowledgment that it's under
review, and an admin decides whether to let them in — including approving
several requests in one sitting. This spec closes the gap directly: it
removes the ungated self-signup path and replaces it with a request +
approval flow built on top of the invite mechanism already shipped.

Alongside that, the existing user table on `/admin/users` (shipped just
before this spec) currently only supports per-row Suspend/Unsuspend and
Make-admin/Remove-admin — there is no way to delete a user's account at
all, and every action works one row at a time. This amendment adds Delete
(the account is gone, not just locked out) and extends the same
checkbox-selection + bulk-action pattern this spec already designed for
the applications queue to the user table too, so Suspend, Unsuspend, and
Delete can all be applied to several users in one sitting the same way
Approve/Reject can for applications.

## Non-goals

- Any captcha, rate-limiting, or other anti-abuse tooling on the public
  submission endpoint. This is a low-traffic household app; an open,
  unauthenticated INSERT endpoint is an accepted risk here, not an
  oversight to revisit later without a concrete reason.
- An applicant-facing "check my application status" page. The one-time
  inline confirmation shown right after submission is the only feedback an
  applicant gets from the app itself — the actual notice of approval is the
  invite email, exactly as it already works for an admin-initiated invite.
- Notifying the admin when a new application arrives (email, in-app badge,
  etc.). They check the queue on `/admin/users` when they choose to.
- `apps/mobile` (the React Native app). Web only, matching the platform
  admin feature's own scope decision.
- Changing how suspend/unsuspend/grant/revoke themselves work, or the
  `platform_admins` table/RLS. This spec is additive on top of the platform
  admin feature — it adds one new `admin-manage-users` action (`delete_user`)
  and reuses `inviteUser`/`suspendUser`/`unsuspendUser` exactly as shipped.
- Any "undo" for delete, or a soft-delete/archive state. Deleting a user is
  exactly what it sounds like — `admin.auth.admin.deleteUser()`, no
  in-between state. The only safety net is a confirmation prompt before it
  happens (see Delete user section) and the database's own existing
  `on delete restrict` on `households.created_by` (see Current state),
  neither of which is new to this spec.
- Reassigning a household's ownership, or any UI for resolving "this user
  created a household and can't be deleted." The admin sees a clear error
  explaining why and has to resolve it themselves outside this feature
  (e.g. by deleting the household, or via a future household-transfer
  feature this spec does not build).

## Current state (for reference)

- `apps/web/src/app/login/page.tsx`: a `Mode = 'sign-in' | 'sign-up' |
  'forgot-password'` toggle. The `sign-up` branch of `handleSubmit`
  (line 151) calls `signUp(email, password)` from `useAuth()`
  (`AuthProvider.tsx`'s `signUp`, which is a thin wrapper over
  `supabase.auth.signUp({ email, password })`) — this is the exact call
  site this spec removes. The page already has an established visual
  language (a two-pane shell — `shellStyle`/`visualPaneStyle`/
  `formPaneStyle` — a mode-driven heading/subheading/submitLabel, a
  `status`/`statusIsError` inline message pattern, and a mode-switch link
  at the bottom) that the new `apply` mode reuses rather than diverging
  from.
- `apps/web/src/app/admin/users/page.tsx`: the platform admin page shipped
  just before this spec. Already has the access-gate pattern (`authLoading
  || checkingAccess` → `null`; no session → sign-in prompt; session but
  `!isAdmin` → "You don't have access to this page."; admin → real
  content), the `useIsMobile()` table/stacked-card branch, and an inline
  invite form (`handleInvite`, lines 63-79) that calls `inviteUser` from
  `@pantry/supabase-client` and refreshes a list on success. This spec adds
  a second section to this same page rather than a new route — it's still
  "who has access to this app," the same concern the page already owns.
- `packages/supabase-client/src/platformAdmin.ts`: exports `inviteUser(client,
  email): Promise<void>`, which calls the `admin-manage-users` Edge
  Function's `invite_user` action (already deployed) and throws with the
  real server-side error message on failure (fixed in this feature's own
  final review — `invokeAdminFn`'s `error.context` extraction, lines
  23-46). This spec's approval flow calls this function completely
  unchanged; no Edge Function work is needed here.
- `apps/web/src/app/reset-password/page.tsx`: already handles "a session
  was established by an email link, now set a password," and its
  `!session` branch's copy already covers both password-reset and
  account-invite emails (also fixed in the same final review). An approved
  applicant's invite email lands here exactly like an admin-invited user's
  does today — no changes needed to this page either.
- `is_platform_admin()` (SQL function, `security definer`): the existing
  RLS building block this spec's admin-only policies reuse directly.
- `households.created_by uuid not null references auth.users(id) on
  delete restrict` (`20260913000001_initial_schema.sql`). This is the one
  existing constraint that makes Delete user non-trivial: Postgres will
  refuse to delete an `auth.users` row while any household still names
  that user as `created_by`, failing the whole delete with a foreign-key
  violation rather than silently orphaning or cascading away that
  household's data. `household_members.user_id` and `platform_admins.user_id`
  are both `on delete cascade` by contrast — deleting a user who is a plain
  household member, or an admin, removes those rows automatically (and for
  `platform_admins`, still runs into `prevent_removing_last_admin`'s
  `before delete` trigger exactly as it would for an explicit demote, since
  a cascade delete fires the referencing table's own triggers the same way
  a direct delete does).
- `admin-manage-users`'s existing `suspend_user`/`unsuspend_user` actions
  already share a `targetUserId === callerId` self-target guard
  (`index.ts`, confirmed in this feature's final review) — `delete_user`
  needs the identical guard, new code but not a new pattern.
- `apps/web/src/app/admin/users/page.tsx`'s existing `isSelf` check (used
  today to disable "Remove admin" on the signed-in admin's own row) is the
  direct precedent for disabling that same row's new selection checkbox.

## Data model changes

New migration:

```sql
create table access_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create unique index access_applications_pending_email
  on access_applications (email)
  where status = 'pending';

alter table access_applications enable row level security;

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
```

- `access_applications` holds requests, not accounts — no `auth.users` row
  exists for an applicant until an admin approves them (via the existing
  invite flow, which creates one). This is the core design choice from
  this feature's brainstorming: keep "someone asked for access" and
  "someone has access" as clearly separate concepts, since conflating them
  with the platform-admin feature's suspend/ban mechanism would make
  "Suspended" in the admin's user list ambiguous between "a locked-out
  existing user" and "someone who never had access," and would leave
  permanently-banned throwaway accounts behind for every abandoned or
  rejected application.
- The partial unique index (`where status = 'pending'`) means re-submitting
  the same email while a prior application is still pending does not
  create a second row — the insert fails with a unique-violation, which
  the client-side wrapper (below) catches and treats identically to a
  successful first submission. This also means the app never reveals
  whether a given email has already applied, a small incidental privacy
  benefit of the simplest correct implementation, not a goal in its own
  right.
- The INSERT policy's `with check` deliberately constrains `status`,
  `reviewed_at`, and `reviewed_by` to their just-submitted defaults — an
  anonymous submitter cannot insert a row that claims to already be
  approved or already reviewed, only a genuinely fresh pending request.
- SELECT and UPDATE are both admin-only via `is_platform_admin()`, the
  same building block `platform_admins`' own policies already use — no new
  RLS helper function needed.
- No DELETE policy. Rejecting an application is a status update
  (`status = 'rejected'`), not a row removal — keeps a record of every
  reviewed application rather than silently discarding rejected ones.

Regenerate the hand-maintained `Database` type
(`packages/supabase-client/src/types.ts`) to add the `access_applications`
table, following the exact pattern already used for `platform_admins`.

## `packages/supabase-client` additions

New file `packages/supabase-client/src/accessApplications.ts`, mirroring
`platformAdmin.ts`'s one-file-per-concern layout:

```ts
export interface AccessApplication {
  id: string;
  email: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

export async function submitApplication(client, email: string, message?: string): Promise<void>;
export async function listPendingApplications(client): Promise<AccessApplication[]>;
export async function markApplicationApproved(client, applicationId: string, reviewedBy: string): Promise<void>;
export async function markApplicationRejected(client, applicationId: string, reviewedBy: string): Promise<void>;
```

- `submitApplication` inserts a row (`email`, `message: message?.trim() ||
  null`). On a unique-violation error (Postgres error code `23505`,
  matching the partial index above), it resolves successfully instead of
  throwing — from the caller's perspective, "your application is already
  in the queue" and "your application was just added to the queue" look
  identical, matching the UX decision that submission always ends in the
  same acknowledgment regardless of whether it's a first-time or repeat
  submission. Any other error still throws normally.
- `listPendingApplications` selects `status = 'pending'` rows ordered
  `submitted_at` ascending (oldest first — the queue reads top-to-bottom
  in submission order, matching how a queue is generally expected to
  behave). RLS restricts this to admins already; the function itself adds
  no additional authorization logic, same as `platformAdmin.ts`'s
  `listAllUsers` relying on its Edge Function's own server-side check.
- `markApplicationApproved` / `markApplicationRejected` are plain
  `update()` calls setting `status`, `reviewed_at: new Date().toISOString()`,
  `reviewed_by: reviewedBy` — RLS-gated, no Edge Function involved (same
  reasoning as `grantAdmin`/`revokeAdmin`: this is a direct table write,
  not a privileged Auth Admin API call). **Approving an application is two
  separate calls from the caller's side** — `inviteUser(client, email)`
  (existing, unchanged) followed by `markApplicationApproved(...)` — not a
  single combined function. Keeping them separate means the admin page's
  bulk-approve loop (below) can isolate a failure in one from a failure in
  the other, and means this file never needs to know about
  `admin-manage-users` at all.

## UI: extending `/admin/users`

A new "Pending applications" section is added to the existing
`apps/web/src/app/admin/users/page.tsx`, positioned above the existing
user-management table (reviewing who's asking to get in is the more
time-sensitive of the two concerns on this page). Structure:

- A `Set<string>` of selected application ids drives a checkbox per row
  (email, optional message, submitted date formatted the same way
  `formatJoined` already formats `createdAt` elsewhere on this page) and a
  header checkbox that selects/clears all currently-listed pending
  applications.
- A toolbar that appears only when the selection is non-empty: "Approve N
  selected" and "Reject N selected" buttons (N = `selectedIds.size`).
  Per-row Approve/Reject buttons remain available too, for reviewing one
  at a time — bulk and single-row action share the same underlying handler
  (approving one application is "bulk approve" with a selection size of
  one), not two separate code paths.
- **Approve** (single or bulk): for each selected application, call
  `inviteUser(supabase, application.email)`, then
  `markApplicationApproved(supabase, application.id, session.user.id)`.
  One application's failure (e.g. `inviteUser` rejects because the email
  is already a registered user) is caught, recorded against that specific
  row, and does not stop the rest of the batch from processing — the same
  per-item isolation philosophy already established in
  `compute-and-send-reminders` (one bad recipient never blocks the others)
  and in this page's own existing code. After the loop, the pending list
  is refreshed once (not once per item) and any per-row failures are shown
  inline next to the affected row(s), while everything that succeeded
  simply disappears from the (now-refreshed) pending list.
- **Reject** (single or bulk): for each selected application, call
  `markApplicationRejected(supabase, application.id, session.user.id)`,
  with the same per-item isolation as Approve — a single row's update can
  still fail (a network blip, say), and that failure must not stop the
  rest of the batch either. Simpler than Approve only in that there's one
  operation per item instead of two chained ones, not in whether failure
  is possible.
- Empty state: "No pending applications." when the list is empty (this
  page currently has no empty-state message anywhere, noted as a gap by
  the platform admin feature's own final review but left unfixed there —
  this new section does not repeat that gap).
- Mobile: this section uses the same `useIsMobile()` stacked-card
  approach as the rest of the page (and the same table-clipping bug this
  app has already been bitten by once) — cards instead of a table row,
  each with its own checkbox, and the bulk toolbar sits above the card
  list rather than as a table header row.

## Delete user (new `admin-manage-users` action)

A new action in the existing Edge Function, `supabase/functions/admin-manage-users/index.ts`,
following the exact shape of `suspend_user`/`unsuspend_user`:

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
    // created a household fails at the database level. Translate that into
    // something an admin can act on instead of a raw constraint-violation
    // message. The exact wording Supabase's Admin API surfaces for this case
    // needs confirming against the real error during Task 6-style live
    // verification (see Testing) — match broadly (constraint name OR the
    // word "household") so the translation still fires even if the exact
    // phrasing differs from what's guessed here.
    const isHouseholdRestrictViolation = /household/i.test(error.message) || /foreign key/i.test(error.message);
    const message = isHouseholdRestrictViolation
      ? "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again."
      : error.message;
    return jsonResponse({ status: 'error', message }, 400);
  }
  return jsonResponse({ status: 'ok' });
}
```

`packages/supabase-client/src/platformAdmin.ts` gets one new export,
reusing the already-fixed `invokeAdminFn` helper (no new error-handling
code needed client-side — Finding 1's fix from the platform admin
feature's final review already made real server messages surface
correctly through every action, this one included):

```ts
export async function deleteUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  await invokeAdminFn(client, { action: 'delete_user', targetUserId });
}
```

## Bulk actions for the existing user table

`apps/web/src/app/admin/users/page.tsx`'s user table (both the desktop
`<table>` and the mobile stacked-card branch) gets the same
checkbox-selection + bulk-toolbar pattern already designed above for the
applications queue:

- A `Set<string>` of selected user ids. A checkbox per row, plus a header
  checkbox that selects/clears every currently-listed user *except* the
  signed-in admin's own row — that row's checkbox is disabled outright
  (same `isSelf` check the page already uses to disable "Remove admin" on
  that row), so the admin can never select themselves into a bulk suspend
  or bulk delete in the first place. This is a UI-level convenience on top
  of the Edge Function's own self-target guards (both existing, for
  suspend/unsuspend, and new, for delete) — the guards are the actual
  enforcement; the disabled checkbox just means a self-targeted error
  never has a reason to appear.
- A toolbar that appears once the selection is non-empty: "Suspend
  selected (N)", "Unsuspend selected (N)", "Delete selected (N)". All
  three act on the current selection regardless of each user's individual
  current state — "Suspend selected" calls `suspendUser` for every
  selected id even if some are already suspended (a no-op success for
  those, since re-applying the same ban state is idempotent), rather than
  the toolbar trying to compute a mixed "some suspend, some unsuspend"
  split. This keeps the bulk action predictable — the button always does
  exactly what it says for the whole selection — instead of context-
  sensitive per-item behavior that's harder to reason about from the UI
  alone.
- Suspend/unsuspend follow the same per-item-isolated-loop-then-single-
  refresh pattern as the applications queue's bulk approve/reject: one
  user's failure doesn't block the rest of the batch, and the selection is
  cleared after the batch completes (whether every item succeeded or not)
  since some of the selected rows may no longer be in their prior state
  after the refresh.
- **Delete selected** additionally requires a confirmation before it runs
  anything, since unlike suspend it has no undo:
  `window.confirm(`Delete ${n} user${n === 1 ? '' : 's'}? This cannot be
  undone.`)` — declining leaves the selection untouched and calls nothing.
  On confirm, the same per-item-isolated loop calls `deleteUser` for each
  selected id; a user who can't be deleted (e.g. they created a household)
  is left in the list with an inline error rather than silently skipped,
  so the admin knows exactly which ones need manual attention.
- The existing per-row actions gain a "Delete" button alongside
  Suspend/Unsuspend and Make-admin/Remove-admin, with the identical
  `window.confirm(...)` gate for a single user (`Delete ${email}? This
  cannot be undone.`) before calling `deleteUser` + a single refresh.
  Deleting one user this way and deleting one user via a one-item bulk
  selection behave identically — same guard, same call, same isolation —
  there is no separate code path for "single" vs. "bulk" beyond the
  confirmation copy pluralization.

## Submission flow: `/admin/apply` replaces sign-up on the login page

`apps/web/src/app/login/page.tsx`'s `Mode` type changes from `'sign-in' |
'sign-up' | 'forgot-password'` to `'sign-in' | 'apply' | 'forgot-password'`.
The `apply` mode:

- Shows an Email field (as today) and a new optional "Anything you'd like
  us to know? (optional)" multi-line field in place of the Password field
  — an applicant never sets a password themselves at this stage; that
  happens later, via the same invite-email flow an admin-initiated invite
  already uses.
- `handleSubmit`'s `mode === 'sign-up'` branch (currently `await
  signUp(email, password)`) is replaced with `await
  submitApplication(supabase, email, message)`.
- On success, instead of the current sign-up branch's transient status
  message ("Account created...", which still lets the form be resubmitted),
  the form itself is replaced in place by a confirmation panel: *"Your
  application has been submitted. We'll review it and get in touch once
  you're approved."* — matching this feature's core UX requirement that
  submission always ends in this acknowledgment (see `submitApplication`'s
  duplicate-handling above: a repeat submission reaches this exact same
  screen, not an error).
- The bottom mode-switch link's `sign-in`/`sign-up` label pair ("Don't have
  an account? Sign up" / "Already have an account? Sign in") becomes
  `sign-in`/`apply` ("Don't have an account? Apply for access" / "Already
  have an account? Sign in").
- `useAuth()`'s `signUp` function (`AuthProvider.tsx`) is left in place,
  unused by this page after this change — removing it entirely is out of
  scope for this spec (YAGNI: deleting dead code that costs nothing to
  leave and touches a shared provider is a separate, lower-value cleanup,
  not bundled into a user-facing feature change).

## Error handling

- `submitApplication` throws on any error other than the expected
  unique-violation (matching every other function in this codebase's
  established `if (error) throw error` convention, with one explicit,
  named exception).
- The login page's `apply` mode reuses the exact `status`/`statusIsError`
  inline-message pattern already on the page for its own error case (e.g.
  a network failure) — only the *success* path diverges into the
  full-form-replacement confirmation described above.
- The admin page's bulk approve/reject loops isolate per-item failures
  (described above) rather than using `Promise.all` unguarded, which would
  let one rejection abort visibility into which others succeeded. The same
  applies to the user table's bulk suspend/unsuspend/delete loops.
- `delete_user`'s households-restrict-violation translation (see Delete
  user section) is the one place in this feature that inspects an error's
  *message text* to decide what to show, rather than just passing a server
  message straight through — flagged explicitly there as needing
  confirmation against the real error text Supabase's Admin API returns,
  not just the guessed pattern in the spec.

## Testing

- Unit tests for `packages/supabase-client/src/accessApplications.ts`,
  mocking the client the same way `platformAdmin.test.ts` does — including
  a specific test that a `23505`-coded insert error resolves successfully
  rather than throwing, and that any other error code still throws.
- Manual verification of the migration once applied (same as every
  migration in this project — no local Postgres/pgTAP setup exists here):
  confirm an anonymous `insert` succeeds, confirm a second `insert` for the
  same pending email hits the unique constraint, confirm a non-admin
  `select`/`update` returns nothing/fails under RLS.
- Live Playwright check (`run-web` pattern): submit an application with no
  session active, confirm the confirmation panel replaces the form and
  that no session/account was created as a side effect; sign in as the
  seed admin, confirm the application appears in the Pending applications
  section; seed two more pending applications directly via REST, select
  all via the header checkbox, bulk-approve, confirm all three move out of
  the pending list and `inviteUser` was called for each (verifiable via
  each application's `status` flipping to `approved` and `reviewed_by`
  being set); separately verify a single reject via a per-row action.
- Live Playwright check for the user table's new actions: seed a few
  throwaway test users, confirm the signed-in admin's own row has no
  usable checkbox, select two of the throwaway users and bulk-suspend,
  confirm both flip to "Suspended"; bulk-unsuspend the same two, confirm
  they flip back; select one and delete it (declining the confirm first to
  verify nothing happens, then accepting), confirm it disappears from the
  list. **Specifically and separately**: create a throwaway user, have
  them create a household (so they're a real `households.created_by`),
  attempt to delete that user via the admin panel, and confirm a clear
  "this user created a household" message appears rather than a raw
  database error — this is the one behavior in this spec that can't be
  fully trusted from a code read alone and needs a real database round
  trip to confirm the actual error text/shape matches what the
  translation logic expects.
