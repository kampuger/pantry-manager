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
