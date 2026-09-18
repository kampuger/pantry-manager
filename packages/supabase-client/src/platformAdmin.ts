import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AdminUserRow {
  id: string;
  email: string | null;
  createdAt: string;
  /** null/past = active, future = suspended — matches Supabase Auth's own `banned_until` field directly rather than inventing a separate status enum. */
  bannedUntil: string | null;
  isAdmin: boolean;
}

/**
 * Invokes admin-manage-users and unwraps its response. supabase-js's
 * FunctionsHttpError only carries a fixed generic message on `.message` —
 * the actual server-provided message (from admin-manage-users' own JSON
 * body, e.g. "already registered" or "Forbidden: ...") is only reachable
 * via `error.context`, the raw Response the function returned. Without
 * this, every server-side error message this Edge Function was written to
 * produce gets silently replaced with "Edge Function returned a non-2xx
 * status code" on the way to the UI.
 */
async function invokeAdminFn(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>
): Promise<any> {
  const { data, error } = await client.functions.invoke('admin-manage-users', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let serverMessage: string | undefined;
    if (context) {
      try {
        const parsed = (await context.clone().json()) as { message?: string };
        serverMessage = parsed?.message;
      } catch {
        // Response body wasn't JSON, or already consumed — fall through to the generic error below.
      }
    }
    if (serverMessage) throw new Error(serverMessage);
    throw error;
  }
  if (!data || data.status !== 'ok') {
    throw new Error(data?.message ?? 'Unexpected response from admin-manage-users');
  }
  return data;
}

/** Whether the signed-in caller is a platform admin. Drives both the /admin/users access check and the conditional "Admin" nav link. */
export async function checkIsPlatformAdmin(client: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await client.rpc('is_platform_admin', {});
  if (error) throw error;
  return !!data;
}

/**
 * All of the above go through the `admin-manage-users` Edge Function
 * because they need Supabase's Auth Admin API, which only works with the
 * service_role key — never available in the browser. The function itself
 * re-checks the caller is a platform admin server-side; it isn't trusted
 * client-side alone.
 */
export async function listAllUsers(client: SupabaseClient<Database>): Promise<AdminUserRow[]> {
  const data = await invokeAdminFn(client, { action: 'list_users' });
  return data.users ?? [];
}

export async function inviteUser(client: SupabaseClient<Database>, email: string): Promise<void> {
  await invokeAdminFn(client, { action: 'invite_user', email });
}

export async function suspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  await invokeAdminFn(client, { action: 'suspend_user', targetUserId });
}

export async function unsuspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  await invokeAdminFn(client, { action: 'unsuspend_user', targetUserId });
}

export async function deleteUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  await invokeAdminFn(client, { action: 'delete_user', targetUserId });
}

/**
 * Unlike suspend/invite/list, granting or revoking admin needs no Auth
 * Admin API access — it's a plain write to `platform_admins`, gated by
 * that table's own RLS policies (only an existing admin may write to it).
 */
export async function grantAdmin(
  client: SupabaseClient<Database>,
  targetUserId: string,
  grantedBy: string
): Promise<void> {
  const { error } = await client.from('platform_admins').insert({ user_id: targetUserId, granted_by: grantedBy });
  if (error) throw error;
}

export async function revokeAdmin(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.from('platform_admins').delete().eq('user_id', targetUserId);
  if (error) throw error;
}

export interface HouseholdSummary {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * Looks up the household a given user created, with its member count, for
 * the admin confirmation dialog before deleting it. Returns null if the
 * user doesn't currently own a household (e.g. it was already deleted by
 * someone else in a race) — the caller treats that as "nothing to delete,
 * just retry the user delete directly."
 */
export async function getHouseholdOwnedBy(
  client: SupabaseClient<Database>,
  userId: string
): Promise<HouseholdSummary | null> {
  const { data: household, error } = await client
    .from('households')
    .select('id, name')
    .eq('created_by', userId)
    .maybeSingle();
  if (error) throw error;
  if (!household) return null;

  const { count, error: countError } = await client
    .from('household_members')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', household.id);
  if (countError) throw countError;

  return { id: household.id, name: household.name, memberCount: count ?? 0 };
}

export async function deleteHousehold(client: SupabaseClient<Database>, householdId: string): Promise<void> {
  const { error } = await client.from('households').delete().eq('id', householdId);
  if (error) throw error;
}
