import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface NewGroceryListEntryInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
}

export async function addGroceryListEntry(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  input: NewGroceryListEntryInput
): Promise<Database['public']['Tables']['grocery_list_entries']['Row']> {
  const { data, error } = await client
    .from('grocery_list_entries')
    .insert({
      household_id: householdId,
      added_by: userId,
      name: input.name,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function setGroceryListEntryChecked(
  client: SupabaseClient<Database>,
  entryId: string,
  isChecked: boolean
): Promise<void> {
  const { error } = await client
    .from('grocery_list_entries')
    .update({ is_checked: isChecked })
    .eq('id', entryId);

  if (error) throw error;
}

export async function deleteGroceryListEntry(client: SupabaseClient<Database>, entryId: string): Promise<void> {
  const { error } = await client.from('grocery_list_entries').delete().eq('id', entryId);

  if (error) throw error;
}
