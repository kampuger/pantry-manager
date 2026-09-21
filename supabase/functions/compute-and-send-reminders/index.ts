import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildDigestEmail } from '../../../packages/core/src/notificationDigest.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const RESEND_FROM = Deno.env.get('RESEND_FROM_ADDRESS')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  const { error: refreshError } = await admin.rpc('refresh_household_reminders', {
    p_household_id: householdId,
  });
  if (refreshError) {
    return new Response(`Failed to refresh reminders: ${refreshError.message}`, { status: 500, headers: corsHeaders });
  }

  const { data: household, error: householdError } = await admin
    .from('households')
    .select('name, notify_email_intro, last_digest_sent_date')
    .eq('id', householdId)
    .single();
  if (householdError || !household) {
    return new Response(`Failed to load household: ${householdError?.message ?? 'not found'}`, { status: 500, headers: corsHeaders });
  }

  const todayManila = manilaDateString(new Date());

  if (household.last_digest_sent_date === todayManila) {
    return new Response(JSON.stringify({ status: 'already_sent_today' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: reminders, error: remindersError } = await admin
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);
  if (remindersError) {
    return new Response(`Failed to load reminders: ${remindersError.message}`, { status: 500, headers: corsHeaders });
  }

  if (!reminders || reminders.length === 0) {
    return new Response(JSON.stringify({ status: 'no_eligible_items' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: members, error: membersError } = await admin
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('notifications_enabled', true);
  if (membersError) {
    return new Response(`Failed to load members: ${membersError.message}`, { status: 500, headers: corsHeaders });
  }

  if (!members || members.length === 0) {
    return new Response(JSON.stringify({ status: 'no_opted_in_members' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const todayMs = Date.parse(`${todayManila}T00:00:00Z`);
  const digestItems = reminders
    .filter((row: any) => row.pantry_items)
    .map((row: any) => {
      const expiryMs = Date.parse(`${row.pantry_items.expiration_date}T00:00:00Z`);
      const daysUntilExpiry = Math.round((expiryMs - todayMs) / (1000 * 60 * 60 * 24));
      return { name: row.pantry_items.name as string, daysUntilExpiry };
    });

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

  // Set only after attempting the batch — a crash before this point (e.g.
  // the reminders/members queries failing) leaves last_digest_sent_date
  // untouched so a later retry the same day can still send.
  await admin.from('households').update({ last_digest_sent_date: todayManila }).eq('id', householdId);

  return new Response(JSON.stringify({ status: 'sent', results }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
