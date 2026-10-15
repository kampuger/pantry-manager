import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildDigestEmail,
  shouldMarkDigestSent,
  type DigestItem,
} from '../../../packages/core/src/notificationDigest.ts';
import { buildDigestSms } from '../../../packages/core/src/digestSms.ts';
import { createSmsProvider } from '../../../packages/core/src/smsProvider.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM = Deno.env.get('RESEND_FROM_ADDRESS')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AdminClient = ReturnType<typeof createClient>;

interface ChannelOutcome {
  status: string;
  results?: unknown[];
  error?: string;
}

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized));
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

function manilaDateString(date: Date): string {
  // en-CA gives YYYY-MM-DD directly, avoiding a second parse/format step.
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sendEmailDigest(
  admin: AdminClient,
  householdId: string,
  household: { name: string; notify_email_intro: string | null; last_digest_sent_date: string | null },
  todayManila: string,
  digestItems: DigestItem[]
): Promise<ChannelOutcome> {
  if (household.last_digest_sent_date === todayManila) {
    return { status: 'already_sent_today' };
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true);
  if (membersError) {
    return { status: 'error', error: `Failed to load members: ${membersError.message}` };
  }
  if (!members || members.length === 0) {
    return { status: 'no_opted_in_members' };
  }

  const { subject, body } = buildDigestEmail({
    householdName: household.name,
    introText: household.notify_email_intro,
    items: digestItems,
  });

  const results: { userId: string; ok: boolean; error?: string }[] = [];
  for (const member of members) {
    const { data: userResult, error: userLookupError } = await admin.auth.admin.getUserById(member.user_id);
    const email = userResult?.user?.email;
    if (userLookupError || !email) {
      results.push({ userId: member.user_id, ok: false, error: userLookupError?.message ?? 'no email on file' });
      continue;
    }

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, text: body }),
      });
      if (!resendResponse.ok) {
        const detail = await resendResponse.text();
        results.push({ userId: member.user_id, ok: false, error: `Resend ${resendResponse.status}: ${detail}` });
        continue;
      }
      results.push({ userId: member.user_id, ok: true });
    } catch (err) {
      results.push({ userId: member.user_id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Set only once at least one email actually went out — a crash before this
  // point (e.g. the reminders/members queries failing) or a batch where every
  // send failed leaves last_digest_sent_date untouched so a later retry the
  // same day can still send.
  if (!shouldMarkDigestSent(results)) {
    return { status: 'send_failed', results };
  }

  await admin.from('households').update({ last_digest_sent_date: todayManila }).eq('id', householdId);
  return { status: 'sent', results };
}

async function sendSmsDigest(
  admin: AdminClient,
  householdId: string,
  householdName: string,
  todayManila: string,
  digestItems: DigestItem[]
): Promise<ChannelOutcome> {
  let provider;
  try {
    provider = createSmsProvider(
      { SMS_PROVIDER: Deno.env.get('SMS_PROVIDER'), TEXTBEE_API_KEY: Deno.env.get('TEXTBEE_API_KEY') },
      fetch
    );
  } catch (err) {
    console.error('compute-and-send-reminders: SMS provider not configured', err);
    return { status: 'sms_not_configured' };
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true)
    .eq('sms_enabled', true);
  if (membersError) {
    return { status: 'error', error: `Failed to load SMS members: ${membersError.message}` };
  }
  if (!members || members.length === 0) {
    return { status: 'no_opted_in_members' };
  }

  const userIds = members.map((member: { user_id: string }) => member.user_id);
  const [{ data: phones, error: phonesError }, { data: delivered, error: deliveredError }] = await Promise.all([
    admin.from('user_phone_numbers').select('user_id, phone_e164').in('user_id', userIds),
    admin
      .from('notification_deliveries')
      .select('user_id')
      .eq('household_id', householdId)
      .eq('channel', 'sms')
      .eq('digest_date', todayManila)
      .eq('status', 'sent')
      .in('user_id', userIds),
  ]);
  if (phonesError || deliveredError) {
    return { status: 'error', error: `Failed to load SMS recipients: ${(phonesError ?? deliveredError)!.message}` };
  }

  const phoneByUser = new Map<string, string>(
    (phones ?? []).map((row: { user_id: string; phone_e164: string }) => [row.user_id, row.phone_e164])
  );
  const alreadySent = new Set<string>((delivered ?? []).map((row: { user_id: string }) => row.user_id));
  const text = buildDigestSms({ householdName, items: digestItems });

  const results: { userId: string; status: string; error?: string }[] = [];
  for (const userId of userIds) {
    if (alreadySent.has(userId)) {
      results.push({ userId, status: 'already_sent' });
      continue;
    }
    const phone = phoneByUser.get(userId);
    if (!phone) {
      results.push({ userId, status: 'no_verified_number' });
      continue;
    }

    const sent = await provider.send({ to: phone, text });
    const { error: logError } = await admin.from('notification_deliveries').upsert(
      {
        household_id: householdId,
        user_id: userId,
        channel: 'sms',
        digest_date: todayManila,
        status: sent.ok ? 'sent' : 'failed',
        provider_message_id: sent.ok ? sent.id ?? null : null,
        error: sent.ok ? null : sent.error,
      },
      { onConflict: 'household_id,user_id,channel,digest_date' }
    );
    if (logError) console.error('compute-and-send-reminders: could not log SMS delivery', logError.message);
    results.push(sent.ok ? { userId, status: 'sent' } : { userId, status: 'failed', error: sent.error });
  }

  if (results.some((result) => result.status === 'sent')) return { status: 'sent', results };
  if (results.some((result) => result.status === 'failed')) return { status: 'send_failed', results };
  return { status: 'nothing_to_send', results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  // The gateway verifies the JWT signature (verify_jwt is pinned to true in
  // supabase/config.toml), so the role claim is trustworthy here. We used to
  // also require the token to equal SUPABASE_SERVICE_ROLE_KEY, but that env
  // value can drift from the key the cron job sends after an API-key refresh,
  // which silently 401'd every scheduled run.
  const authHeader = req.headers.get('Authorization');
  const callerRole = decodeJwtRole(authHeader);
  if (callerRole !== 'service_role' && callerRole !== 'authenticated') {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  let householdId: string | undefined;
  try {
    const payload = await req.json();
    householdId = payload.household_id;
  } catch {
    return new Response('Invalid JSON body', { status: 400, headers: corsHeaders });
  }
  if (!householdId) {
    return new Response('household_id is required', { status: 400, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (callerRole === 'authenticated') {
    const token = authHeader!.slice('Bearer '.length);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    const { data: membership } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', householdId)
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return new Response('Forbidden: only household owners/admins can trigger reminders', { status: 403, headers: corsHeaders });
    }
  }

  const { data: appSettings } = await admin
    .from('app_settings')
    .select('email_notifications_enabled, sms_notifications_enabled')
    .limit(1)
    .maybeSingle();
  const emailGloballyOn = !appSettings || appSettings.email_notifications_enabled !== false;
  const smsGloballyOn = appSettings?.sms_notifications_enabled === true;
  if (!emailGloballyOn && !smsGloballyOn) {
    return jsonResponse({ status: 'disabled_globally' });
  }

  const { error: refreshError } = await admin.rpc('refresh_household_reminders', {
    p_household_id: householdId,
  });
  if (refreshError) {
    return new Response(`Failed to refresh reminders: ${refreshError.message}`, { status: 500, headers: corsHeaders });
  }

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('name, notify_email_intro, last_digest_sent_date, sms_enabled')
    .eq('id', householdId)
    .single();
  if (householdError || !household) {
    return new Response(`Failed to load household: ${householdError?.message ?? 'not found'}`, { status: 500, headers: corsHeaders });
  }

  const todayManila = manilaDateString(new Date());

  const { data: reminders, error: remindersError } = await admin
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);
  if (remindersError) {
    return new Response(`Failed to load reminders: ${remindersError.message}`, { status: 500, headers: corsHeaders });
  }

  if (!reminders || reminders.length === 0) {
    return jsonResponse({ status: 'no_eligible_items' });
  }

  const todayMs = Date.parse(`${todayManila}T00:00:00Z`);
  const digestItems: DigestItem[] = reminders
    .filter((row: any) => row.pantry_items)
    .map((row: any) => {
      const expiryMs = Date.parse(`${row.pantry_items.expiration_date}T00:00:00Z`);
      const daysUntilExpiry = Math.round((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
      return { name: row.pantry_items.name as string, daysUntilExpiry };
    });

  // The two channels are independent: a failure in one never blocks or
  // un-marks the other, and each has its own same-day dedupe.
  // Each channel also runs inside its own try/catch: a thrown error (not just
  // a returned one) in one must not skip the other, or turn a delivered email
  // into a 500.
  async function runChannel(send: () => Promise<ChannelOutcome>): Promise<ChannelOutcome> {
    try {
      return await send();
    } catch (err) {
      console.error('compute-and-send-reminders: channel threw', err);
      return { status: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  const emailOutcome: ChannelOutcome = emailGloballyOn
    ? await runChannel(() => sendEmailDigest(admin, householdId!, household, todayManila, digestItems))
    : { status: 'disabled_globally' };

  let smsOutcome: ChannelOutcome;
  if (!smsGloballyOn) {
    smsOutcome = { status: 'disabled_globally' };
  } else if (!household.sms_enabled) {
    smsOutcome = { status: 'household_disabled' };
  } else {
    smsOutcome = await runChannel(() => sendSmsDigest(admin, householdId!, household.name, todayManila, digestItems));
  }

  const body = { ...emailOutcome, sms: smsOutcome };
  if (emailOutcome.status === 'send_failed') return jsonResponse(body, 502);
  if (emailOutcome.status === 'error') return jsonResponse(body, 500);
  return jsonResponse(body);
});
