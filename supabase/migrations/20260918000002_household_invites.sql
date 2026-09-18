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
  using (lower(email) = lower(auth.email()));
