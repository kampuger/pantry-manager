-- supabase/migrations/20261015000001_sms_notifications.sql

-- =========================================================
-- VERIFIED PHONE NUMBERS
-- One per user. Written only by the sms-verify Edge Function (service role,
-- after the user proves ownership with a code). Users may read and delete
-- their own row; no insert/update policy exists on purpose.
-- =========================================================
create table user_phone_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+639\d{9}$'),
  verified_at timestamptz not null default now()
);

alter table user_phone_numbers enable row level security;

create policy "users can read their own phone number"
  on user_phone_numbers for select
  using (user_id = auth.uid());

create policy "users can delete their own phone number"
  on user_phone_numbers for delete
  using (user_id = auth.uid());

comment on table user_phone_numbers is
  'Verified Philippine mobile number per user (+639XXXXXXXXX). Inserted/updated only by the sms-verify Edge Function after a successful code confirmation.';

-- =========================================================
-- PENDING VERIFICATION CODES
-- RLS on with no policies: only the service role can touch it.
-- =========================================================
create table phone_verifications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+639\d{9}$'),
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  last_sent_at timestamptz not null default now(),
  sends_in_window smallint not null default 1,
  window_started_at timestamptz not null default now()
);

alter table phone_verifications enable row level security;

comment on table phone_verifications is
  'One pending SMS verification per user. Holds a SHA-256 hash of the code, never the code itself. Service-role only (no RLS policies).';

-- Atomic attempt counter: the Edge Function increments before comparing so
-- concurrent guesses cannot share a single attempt.
create or replace function increment_phone_verification_attempts(p_user_id uuid)
returns setof phone_verifications
language sql
security definer
set search_path = pg_catalog, public
as $$
  update phone_verifications
  set attempts = attempts + 1
  where user_id = p_user_id
  returning *;
$$;

revoke execute on function increment_phone_verification_attempts(uuid) from public, anon, authenticated;
grant execute on function increment_phone_verification_attempts(uuid) to service_role;

-- =========================================================
-- OPT-IN SWITCHES
-- =========================================================
alter table household_members
  add column sms_enabled boolean not null default false;

comment on column household_members.sms_enabled is
  'Member opted in to the daily digest by SMS. Only takes effect when the household switch, the global switch and a verified phone number are all present.';

alter table households
  add column sms_enabled boolean not null default false;

comment on column households.sms_enabled is
  'Owner/admin switch that makes SMS available for this household. Members still opt in individually.';

alter table app_settings
  add column sms_notifications_enabled boolean not null default false;

-- Existing policies already cover these columns: "members can update their
-- own notification setting" (household_members), "owners/admins can update
-- household" (households) and "admins can update app settings" (app_settings).

-- =========================================================
-- DELIVERY LOG + PER-DAY DEDUPE
-- The household is part of the key so a member of two households gets both
-- digests. Written only by the Edge Function (service role).
-- =========================================================
create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('sms')),
  digest_date date not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (household_id, user_id, channel, digest_date)
);

create index idx_notification_deliveries_household_date
  on notification_deliveries(household_id, digest_date);

alter table notification_deliveries enable row level security;

create policy "owners and admins can read their household's deliveries"
  on notification_deliveries for select
  using (is_household_admin_or_owner(household_id));

comment on table notification_deliveries is
  'Per-channel send log. The unique key makes a same-day retry skip members who already received the digest.';

-- =========================================================
-- CRON DISPATCH
-- Redefined from 20260928000001_app_settings_email_toggle.sql: it used to
-- return early whenever email was globally off, which would also stop SMS.
-- Now it only skips dispatch when BOTH channels are globally off.
-- =========================================================
create or replace function trigger_due_household_reminders()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_household record;
  v_service_key text;
begin
  if not coalesce(
    (select email_notifications_enabled or sms_notifications_enabled from app_settings where id),
    true
  ) then
    return;
  end if;

  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise warning 'service_role_key not found in Vault; skipping reminder dispatch';
    return;
  end if;

  for v_household in
    select id
    from households
    where mod(
      extract(epoch from ((now() at time zone 'Asia/Manila')::time - notify_email_send_time))::int + 86400,
      86400
    ) < 900
  loop
    perform net.http_post(
      url := 'https://nrjeqeddlssrxaskovrs.supabase.co/functions/v1/compute-and-send-reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_service_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('household_id', v_household.id)
    );
  end loop;
end;
$$;
