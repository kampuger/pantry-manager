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
