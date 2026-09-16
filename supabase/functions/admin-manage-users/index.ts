import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Supabase's ban mechanism has no literal "forever" — this is the
// established convention for an effectively permanent suspension.
// Unsuspending sets the duration back to 'none'.
const PERMANENT_BAN_DURATION = '876000h';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface RequestBody {
  action?: string;
  email?: string;
  targetUserId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice('Bearer '.length);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every caller of this function is an end user's own browser session —
  // unlike compute-and-send-reminders, there is no service_role/pg_cron
  // calling path here, so a bare bearer-token check is sufficient.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
  }
  const callerId = userData.user.id;

  const { data: adminRow } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle();
  if (!adminRow) {
    return jsonResponse({ status: 'error', message: 'Forbidden: platform admin access required' }, 403);
  }

  const { action } = body;

  if (action === 'list_users') {
    const perPage = 200;
    let page = 1;
    const allUsers: Array<{ id: string; email?: string; created_at: string; banned_until?: string }> = [];
    // deno-lint-ignore no-constant-condition
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return jsonResponse({ status: 'error', message: error.message }, 500);
      allUsers.push(...data.users);
      if (data.users.length < perPage) break;
      page += 1;
    }

    const { data: adminRows, error: adminRowsError } = await admin.from('platform_admins').select('user_id');
    if (adminRowsError) return jsonResponse({ status: 'error', message: adminRowsError.message }, 500);
    const adminIds = new Set((adminRows ?? []).map((r) => r.user_id));

    const users = allUsers.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      createdAt: u.created_at,
      bannedUntil: u.banned_until ?? null,
      isAdmin: adminIds.has(u.id),
    }));

    return jsonResponse({ status: 'ok', users });
  }

  if (action === 'invite_user') {
    const email = body.email;
    if (!email || !email.includes('@')) {
      return jsonResponse({ status: 'error', message: 'A valid email is required' }, 400);
    }
    const { error } = await admin.auth.admin.inviteUserByEmail(email);
    if (error) return jsonResponse({ status: 'error', message: error.message }, 400);
    return jsonResponse({ status: 'ok' });
  }

  if (action === 'suspend_user' || action === 'unsuspend_user') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) {
      return jsonResponse({ status: 'error', message: 'targetUserId is required' }, 400);
    }
    if (targetUserId === callerId) {
      return jsonResponse({ status: 'error', message: 'Cannot suspend your own account' }, 400);
    }
    const banDuration = action === 'suspend_user' ? PERMANENT_BAN_DURATION : 'none';
    const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: banDuration });
    if (error) return jsonResponse({ status: 'error', message: error.message }, 400);
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ status: 'error', message: `Unknown action: ${action}` }, 400);
});
