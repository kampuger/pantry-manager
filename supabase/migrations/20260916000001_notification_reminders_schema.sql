-- =========================================================
-- PANTRY ITEM REMINDERS
-- =========================================================
create table pantry_item_reminders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  pantry_item_id uuid not null references pantry_items(id) on delete cascade,
  first_notified_at timestamptz not null default now(),
  last_notified_at timestamptz not null default now(),
  unique (pantry_item_id)
);

create index idx_pantry_item_reminders_household on pantry_item_reminders(household_id);

alter table pantry_item_reminders enable row level security;

create policy "members can read their household's reminders"
  on pantry_item_reminders for select
  using (is_household_member(household_id));

comment on table pantry_item_reminders is
  'One row per currently-expiring pantry item. Existence of a row IS the in-app notification; deleted when the item is archived or no longer eligible. Written only by refresh_household_reminders() (security definer) — no insert/update/delete policy is granted to regular users.';

-- =========================================================
-- HOUSEHOLDS: email digest settings
-- =========================================================
alter table households
  add column notify_email_send_time time not null default '08:00',
  add column notify_email_intro text,
  add column last_digest_sent_date date;

comment on column households.notify_email_send_time is
  'Local (Asia/Manila) time-of-day the daily digest email fires, owner/admin editable.';
comment on column households.notify_email_intro is
  'Optional custom intro line prepended to the digest email body; null renders no extra line.';
comment on column households.last_digest_sent_date is
  'Asia/Manila calendar date the digest was last sent, used to dedupe the scheduled run against an on-demand trigger on the same day.';

-- Existing "owners/admins can update household" policy (20260913000002) already
-- covers writes to these three new columns — no new households policy needed.

-- =========================================================
-- HOUSEHOLD MEMBERS: per-member notification toggle
-- =========================================================
alter table household_members
  add column notifications_enabled boolean not null default true;

comment on column household_members.notifications_enabled is
  'Off means: no in-app bell entries and excluded from the email digest recipient list, for this member in this household. Does not affect other members.';

create policy "members can update their own notification setting"
  on household_members for update
  using (user_id = auth.uid());

-- The policy above is row-scoped only — Postgres RLS cannot restrict which
-- *columns* an UPDATE touches, so a member could otherwise smuggle a role
-- change (or move themselves to a different household_id) into the same
-- call. A trigger closes that gap: any change to role/user_id/household_id
-- still requires the existing owner/admin check.
create or replace function prevent_self_household_member_escalation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (new.role <> old.role or new.user_id <> old.user_id or new.household_id <> old.household_id)
     and not is_household_admin_or_owner(old.household_id) then
    raise exception 'not authorized to change role, user_id, or household_id on household_members';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_self_household_member_escalation
  before update on household_members
  for each row
  execute function prevent_self_household_member_escalation();

-- =========================================================
-- REMINDER ELIGIBILITY & UPSERT (called by the Edge Function via a
-- service-role client; never by regular authenticated users directly)
-- =========================================================
create or replace function refresh_household_reminders(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into pantry_item_reminders (household_id, pantry_item_id, first_notified_at, last_notified_at)
  select
    pi.household_id,
    pi.id,
    now(),
    now()
  from pantry_items pi
  join households h on h.id = pi.household_id
  where pi.household_id = p_household_id
    and pi.is_archived = false
    and pi.expiration_date is not null
    and (pi.expiration_date - current_date) <= coalesce(
      pi.notify_days_before_expiry,
      case when pi.is_produce then h.notify_days_produce else h.notify_days_nonproduce end
    )
  on conflict (pantry_item_id) do update set last_notified_at = now();

  delete from pantry_item_reminders r
  using pantry_items pi
  join households h on h.id = pi.household_id
  where r.pantry_item_id = pi.id
    and r.household_id = p_household_id
    and (
      pi.is_archived = true
      or pi.expiration_date is null
      or (pi.expiration_date - current_date) > coalesce(
        pi.notify_days_before_expiry,
        case when pi.is_produce then h.notify_days_produce else h.notify_days_nonproduce end
      )
    );
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default — revoke it
-- so only a service-role caller (the Edge Function) can run this, keeping
-- the owner/admin check for on-demand triggers entirely inside the Edge
-- Function rather than exposable via a direct client RPC call.
revoke execute on function refresh_household_reminders(uuid) from public;

-- =========================================================
-- ARCHIVE PANTRY ITEM: also clear its reminder row
-- =========================================================
create or replace function archive_pantry_item(
  p_item_id uuid,
  p_event_type text,
  p_quantity numeric,
  p_triggered_by uuid
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household_id uuid;
begin
  select household_id into v_household_id from pantry_items where id = p_item_id;
  if v_household_id is null then
    raise exception 'pantry item % not found', p_item_id;
  end if;

  if not is_household_member(v_household_id) then
    raise exception 'not authorized to archive pantry item %', p_item_id;
  end if;

  update pantry_items set is_archived = true where id = p_item_id;

  insert into inventory_movement_logs (
    household_id, pantry_item_id, event_type, quantity_delta, triggered_by
  )
  values (
    v_household_id,
    p_item_id,
    p_event_type::movement_event_type,
    -abs(p_quantity),
    p_triggered_by
  );

  delete from pantry_item_reminders where pantry_item_id = p_item_id;
end;
$$;

comment on function archive_pantry_item is
  'Atomically archives a pantry item, records its consumed/discarded movement log entry, and clears any pending reminder for it — all in one transaction.';
