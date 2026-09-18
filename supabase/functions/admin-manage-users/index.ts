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

// Same single-hardcoded-target convention as apps/web/src/lib/AuthProvider.tsx's
// RESET_PASSWORD_REDIRECT_URL — an invited user needs to land somewhere that
// can set their password; this app already has that page. Points at the
// deployed production domain (a real Vercel Domain, not a one-off alias).
// Update both constants together if the production domain ever changes.
const INVITE_REDIRECT_URL = 'https://meraki-pantry-tracker.vercel.app/reset-password';

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

  const { data: adminRow, error: adminRowError } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle();
  if (adminRowError) {
    return jsonResponse({ status: 'error', message: adminRowError.message }, 500);
  }
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
    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: INVITE_REDIRECT_URL });
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

  if (action === 'delete_user') {
    const targetUserId = body.targetUserId;
    if (!targetUserId) {
      return jsonResponse({ status: 'error', message: 'targetUserId is required' }, 400);
    }
    if (targetUserId === callerId) {
      return jsonResponse({ status: 'error', message: 'Cannot delete your own account' }, 400);
    }
    const { error } = await admin.auth.admin.deleteUser(targetUserId);
    if (error) {
      // households.created_by is `on delete restrict` — deleting a user who
      // created a household fails at the database level. Translate that
      // into something an admin can act on instead of a raw
      // constraint-violation message. Match on the word "household" so the
      // translation still fires even if Supabase's exact phrasing differs
      // from what's guessed here — Task 7's live verification confirms the
      // real text. Any other foreign-key-shaped violation (e.g. from an
      // unrelated constraint) gets a neutral fallback instead of the
      // households-specific copy, so we don't send the admin to fix the
      // wrong thing.
      const isHouseholdRestrictViolation = /household/i.test(error.message);
      const isGenericForeignKeyViolation = !isHouseholdRestrictViolation && /foreign key/i.test(error.message);
      const message = isHouseholdRestrictViolation
        ? "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again."
        : isGenericForeignKeyViolation
          ? 'This user is still referenced by existing records and cannot be deleted yet.'
          : error.message;
      return jsonResponse({ status: 'error', message }, 400);
    }
    return jsonResponse({ status: 'ok' });
  }

  return jsonResponse({ status: 'error', message: `Unknown action: ${action}` }, 400);
});
