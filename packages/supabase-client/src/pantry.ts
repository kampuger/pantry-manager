import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface NewPantryItemInput {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  expirationDate?: string | null;
}

export async function addPantryItem(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  input: NewPantryItemInput
): Promise<Database['public']['Tables']['pantry_items']['Row']> {
  const { data, error } = await client
    .from('pantry_items')
    .insert({
      household_id: householdId,
      created_by: userId,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      storage_location: input.storageLocation,
      expiration_date: input.expirationDate ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
