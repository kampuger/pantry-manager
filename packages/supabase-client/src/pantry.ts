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

export interface UpdatePantryItemInput {
  name?: string;
  quantity?: number;
  unit?: string;
  storageLocation?: string;
  isProduce?: boolean;
  expirationDate?: string | null;
  notifyDaysBeforeExpiry?: number | null;
}

export async function updatePantryItem(
  client: SupabaseClient<Database>,
  itemId: string,
  input: UpdatePantryItemInput
): Promise<PantryItemRow> {
  const changes: Database['public']['Tables']['pantry_items']['Update'] = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.quantity !== undefined) changes.quantity = input.quantity;
  if (input.unit !== undefined) changes.unit = input.unit;
  if (input.storageLocation !== undefined) changes.storage_location = input.storageLocation;
  if (input.isProduce !== undefined) changes.is_produce = input.isProduce;
  if (input.expirationDate !== undefined) changes.expiration_date = input.expirationDate;
  if (input.notifyDaysBeforeExpiry !== undefined) {
    changes.notify_days_before_expiry = input.notifyDaysBeforeExpiry;
  }

  const { data, error } = await client
    .from('pantry_items')
    .update(changes)
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export type ArchiveEventType = 'CONSUMED' | 'SPOILED_DISCARDED';

export interface ArchivePantryItemInput {
  itemId: string;
  householdId: string;
  quantity: number;
  eventType: ArchiveEventType;
  userId: string;
}

export async function archivePantryItem(
  client: SupabaseClient<Database>,
  input: ArchivePantryItemInput
): Promise<void> {
  const { error: updateError } = await client
    .from('pantry_items')
    .update({ is_archived: true })
    .eq('id', input.itemId);

  if (updateError) throw updateError;

  const { error: logError } = await client.from('inventory_movement_logs').insert({
    household_id: input.householdId,
    pantry_item_id: input.itemId,
    event_type: input.eventType,
    quantity_delta: -Math.abs(input.quantity),
    triggered_by: input.userId,
  });

  if (logError) throw logError;
}
