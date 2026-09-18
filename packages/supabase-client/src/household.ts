import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface HouseholdMembership {
  householdId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export async function getMyHousehold(
  client: SupabaseClient<Database>,
  userId: string
): Promise<HouseholdMembership | null> {
  const { data, error } = await client
    .from('household_members')
    .select('household_id, role')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { householdId: data.household_id, role: data.role };
}

export async function createHousehold(
  client: SupabaseClient<Database>,
  userId: string,
  name: string
): Promise<HouseholdMembership> {
  const { data: household, error: householdError } = await client
    .from('households')
    .insert({ name, created_by: userId })
    .select('id')
    .single();

  if (householdError) throw householdError;

  const { error: memberError } = await client
    .from('household_members')
    .insert({ household_id: household.id, user_id: userId, role: 'OWNER' });

  if (memberError) throw memberError;

  return { householdId: household.id, role: 'OWNER' };
}

export async function redeemHouseholdInvite(
  client: SupabaseClient<Database>,
  code: string
): Promise<HouseholdMembership> {
  const { data, error } = await client.rpc('redeem_household_invite', { invite_code: code });
  if (error) throw error;
  return { householdId: data, role: 'MEMBER' };
}

export interface NotificationPreferences {
  notifyDaysProduce: number;
  notifyDaysNonproduce: number;
  emailSendTime: string;
  emailIntro: string | null;
}

export async function getHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('households')
    .select('notify_days_produce, notify_days_nonproduce, notify_email_send_time, notify_email_intro')
    .eq('id', householdId)
    .single();

  if (error) throw error;
  return {
    notifyDaysProduce: data.notify_days_produce,
    notifyDaysNonproduce: data.notify_days_nonproduce,
    emailSendTime: data.notify_email_send_time,
    emailIntro: data.notify_email_intro,
  };
}

export async function updateHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string,
  prefs: NotificationPreferences
): Promise<void> {
  // `.select()` matters: RLS restricts households UPDATE to owners/admins, and
  // a bare update that matches zero rows comes back as { data: null, error:
  // null } — a silent no-op the UI would report as a successful save.
  const { data, error } = await client
    .from('households')
    .update({
      notify_days_produce: prefs.notifyDaysProduce,
      notify_days_nonproduce: prefs.notifyDaysNonproduce,
      notify_email_send_time: prefs.emailSendTime,
      notify_email_intro: prefs.emailIntro,
    })
    .eq('id', householdId)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('You do not have permission to update notification preferences.');
  }
}

export async function getMemberNotificationsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('household_members')
    .select('notifications_enabled')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();

  if (error) throw error;
  return data.notifications_enabled;
}

export async function setMemberNotificationsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const { data, error } = await client
    .from('household_members')
    .update({ notifications_enabled: enabled })
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .select('id');

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to update your notification setting.');
  }
}
