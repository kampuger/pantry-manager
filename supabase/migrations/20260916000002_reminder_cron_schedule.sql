create extension if not exists pg_net;

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
  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'service_role_key';

  if v_service_key is null then
    raise notice 'service_role_key not found in Vault; skipping reminder dispatch';
    return;
  end if;

  -- A household is "due" when the current Asia/Manila wall-clock time falls
  -- within 15 minutes after its configured send time. Computed via modular
  -- arithmetic on seconds-since-midnight so a send time near midnight (e.g.
  -- 23:55) still matches correctly across the day boundary — a plain
  -- `send_time <= now AND now < send_time + 15min` comparison breaks there
  -- because `time + interval` wraps but the AND does not.
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

revoke execute on function trigger_due_household_reminders() from public;

select cron.schedule(
  'household-reminders-every-15-min',
  '*/15 * * * *',
  $$select trigger_due_household_reminders();$$
);
