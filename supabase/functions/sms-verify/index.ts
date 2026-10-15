import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizePhPhoneNumber } from '../../../packages/core/src/phoneNumber.ts';
import { createSmsProvider } from '../../../packages/core/src/smsProvider.ts';
import {
  CODE_TTL_MS,
  checkSendAllowed,
  evaluateConfirm,
  generateVerificationCode,
  hashVerificationCode,
  type PendingVerification,
} from '../../../packages/core/src/phoneVerification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AdminClient = ReturnType<typeof createClient>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toPending(row: any): PendingVerification {
  return {
    phoneE164: row.phone_e164,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    lastSentAt: row.last_sent_at,
    sendsInWindow: row.sends_in_window,
    windowStartedAt: row.window_started_at,
  };
}

async function deletePending(admin: AdminClient, userId: string) {
  await admin.from('phone_verifications').delete().eq('user_id', userId);
}

async function handleRequest(admin: AdminClient, userId: string, phoneInput: unknown): Promise<Response> {
  const phone = typeof phoneInput === 'string' ? normalizePhPhoneNumber(phoneInput) : null;
  if (!phone) {
    return json(
      {
        error:
          'Enter a Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX). International numbers are not supported.',
      },
      400
    );
  }

  const { data: settings } = await admin
    .from('app_settings')
    .select('sms_notifications_enabled')
    .limit(1)
    .maybeSingle();
  if (!settings?.sms_notifications_enabled) {
    return json({ error: 'SMS notifications are not enabled.' }, 403);
  }

  let provider;
  try {
    provider = createSmsProvider(
      { SMS_PROVIDER: Deno.env.get('SMS_PROVIDER'), TEXTBEE_API_KEY: Deno.env.get('TEXTBEE_API_KEY') },
      fetch
    );
  } catch (err) {
    console.error('sms-verify: provider not configured', err);
    return json({ error: 'SMS is not configured.' }, 503);
  }

  const { data: existing } = await admin.from('phone_verifications').select('*').eq('user_id', userId).maybeSingle();
  const now = new Date();
  const decision = checkSendAllowed(existing ? toPending(existing) : null, now);
  if (!decision.allowed) {
    return json(
      {
        error: `Please wait ${decision.retryAfterSeconds} seconds before requesting another code.`,
        retry_after: decision.retryAfterSeconds,
      },
      429
    );
  }

  const code = generateVerificationCode(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const codeHash = await hashVerificationCode(sha256Hex, userId, phone, code);

  const { error: upsertError } = await admin.from('phone_verifications').upsert({
    user_id: userId,
    phone_e164: phone,
    code_hash: codeHash,
    expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    attempts: 0,
    last_sent_at: now.toISOString(),
    sends_in_window: decision.sendsInWindow,
    window_started_at: decision.windowStartedAt,
  });
  if (upsertError) {
    console.error('sms-verify: could not store code', upsertError.message);
    return json({ error: 'Could not start verification. Try again later.' }, 500);
  }

  const sent = await provider.send({ to: phone, text: `Pantry Manager code: ${code}. Valid for 10 minutes.` });
  if (!sent.ok) {
    await deletePending(admin, userId);
    console.error('sms-verify: send failed', sent.error);
    return json({ error: 'Could not send the code. Try again later.' }, 502);
  }

  return json({ status: 'sent' });
}

async function handleConfirm(admin: AdminClient, userId: string, codeInput: unknown): Promise<Response> {
  if (typeof codeInput !== 'string' || !/^\d{6}$/.test(codeInput)) {
    return json({ error: 'Enter the 6-digit code.' }, 400);
  }

  // Increment first (atomically, in SQL) so concurrent guesses can't share an attempt.
  const { data: rows, error: incrementError } = await admin.rpc('increment_phone_verification_attempts', {
    p_user_id: userId,
  });
  if (incrementError) {
    console.error('sms-verify: increment failed', incrementError.message);
    return json({ error: 'Could not check the code. Try again.' }, 500);
  }
  const row = Array.isArray(rows) ? rows[0] : rows;

  const submittedHash = row ? await hashVerificationCode(sha256Hex, userId, row.phone_e164, codeInput) : '';
  const decision = evaluateConfirm(row ? toPending(row) : null, new Date(), submittedHash);

  switch (decision.kind) {
    case 'no_pending':
      return json({ error: 'No verification in progress. Request a new code.' }, 400);
    case 'expired':
      await deletePending(admin, userId);
      return json({ error: 'That code has expired. Request a new one.' }, 400);
    case 'too_many_attempts':
      await deletePending(admin, userId);
      return json({ error: 'Too many wrong attempts. Request a new code.' }, 429);
    case 'wrong_code':
      return json({ error: `That code is not right. ${decision.attemptsLeft} attempts left.` }, 400);
    case 'ok': {
      const { error: saveError } = await admin.from('user_phone_numbers').upsert({
        user_id: userId,
        phone_e164: row.phone_e164,
        verified_at: new Date().toISOString(),
      });
      if (saveError) {
        console.error('sms-verify: could not save number', saveError.message);
        return json({ error: 'Could not save your number. Try again.' }, 500);
      }
      await deletePending(admin, userId);
      return json({ status: 'verified', phone_e164: row.phone_e164 });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(authHeader.slice('Bearer '.length));
  if (userError || !userData.user) return json({ error: 'Unauthorized' }, 401);
  const userId = userData.user.id;

  let body: { action?: string; phone?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.action === 'request') return handleRequest(admin, userId, body.phone);
  if (body.action === 'confirm') return handleConfirm(admin, userId, body.code);
  return json({ error: 'Unknown action' }, 400);
});
