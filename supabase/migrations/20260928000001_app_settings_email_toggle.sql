-- supabase/migrations/20260928000001_app_settings_email_toggle.sql

-- =========================================================
-- APP SETTINGS
-- First app-wide (not per-household, not per-member) config table. `id`
-- is a boolean primary key constrained to `true` so the table can only
-- ever hold exactly one row — a lighter-weight singleton than an int PK
-- plus a separate uniqueness guard.
-- =========================================================
create table app_settings (
  id boolean primary key default true,
  email_notifications_enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id)
);

insert into app_settings (id) values (true);

alter table app_settings enable row level security;

create policy "admins can read app settings"
  on app_settings for select
  using (is_platform_admin());

-- No insert/delete policy: the single row is seeded by this migration and
-- must never be removed, so only updating its columns is exposed to admins.
create policy "admins can update app settings"
  on app_settings for update
  using (is_platform_admin())
  with check (is_platform_admin());

comment on table app_settings is
  'Singleton row of app-wide settings. Read via RPC/select by platform admins; read directly by security-definer functions and the service-role key, both of which bypass RLS.';

-- Redefine trigger_due_household_reminders (from
-- 20260916000002_reminder_cron_schedule.sql) to skip dispatch entirely
-- while email notifications are globally disabled — avoids firing
-- net.http_post (and the resulting noise in net._http_response) for every
-- due household when the switch is off.
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
  if not coalesce((select email_notifications_enabled from app_settings where id), true) then
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
