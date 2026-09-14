import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

type PantryItemRow = Database['public']['Tables']['pantry_items']['Row'];

export interface NewPantryItemInput {
  name: string;
  quantity: number;
  unit: string;
  storageLocation: string;
  isProduce: boolean;
  expirationDate?: string | null;
  notifyDaysBeforeExpiry?: number | null;
}

export async function addPantryItem(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  input: NewPantryItemInput
): Promise<PantryItemRow> {
  const { data, error } = await client
    .from('pantry_items')
    .insert({
      household_id: householdId,
      created_by: userId,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      storage_location: input.storageLocation,
      is_produce: input.isProduce,
      purchase_date: new Date().toISOString().slice(0, 10),
      expiration_date: input.expirationDate ?? null,
      notify_days_before_expiry: input.notifyDaysBeforeExpiry ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
