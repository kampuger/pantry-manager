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
  const { data, error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'list_users' },
  });
  if (error) throw error;
  return data.users;
}

export async function inviteUser(client: SupabaseClient<Database>, email: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'invite_user', email },
  });
  if (error) throw error;
}

export async function suspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'suspend_user', targetUserId },
  });
  if (error) throw error;
}

export async function unsuspendUser(client: SupabaseClient<Database>, targetUserId: string): Promise<void> {
  const { error } = await client.functions.invoke('admin-manage-users', {
    body: { action: 'unsuspend_user', targetUserId },
  });
  if (error) throw error;
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
