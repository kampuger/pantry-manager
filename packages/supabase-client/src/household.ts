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

export interface NotificationPreferences {
  notifyDaysProduce: number;
  notifyDaysNonproduce: number;
}

export async function getHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<NotificationPreferences> {
  const { data, error } = await client
    .from('households')
    .select('notify_days_produce, notify_days_nonproduce')
    .eq('id', householdId)
    .single();

  if (error) throw error;
  return {
    notifyDaysProduce: data.notify_days_produce,
    notifyDaysNonproduce: data.notify_days_nonproduce,
  };
}

export async function updateHouseholdNotificationPrefs(
  client: SupabaseClient<Database>,
  householdId: string,
  prefs: NotificationPreferences
): Promise<void> {
  const { error } = await client
    .from('households')
    .update({
      notify_days_produce: prefs.notifyDaysProduce,
      notify_days_nonproduce: prefs.notifyDaysNonproduce,
    })
    .eq('id', householdId);

  if (error) throw error;
}
