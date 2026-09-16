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
  purchasePrice?: number | null;
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
      purchase_price: input.purchasePrice ?? null,
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
  purchasePrice?: number | null;
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
  if (input.purchasePrice !== undefined) changes.purchase_price = input.purchasePrice;

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

/**
 * Archives the item and appends its movement-log entry. Both writes happen
 * inside the `archive_pantry_item` Postgres function (see
 * `supabase/migrations/20260915000001_archive_pantry_item_function.sql`) so
 * they share one transaction and cannot go out of sync.
 *
 * `householdId` stays in the input for call-site symmetry, but the function
 * derives the household from the item row itself.
 */
export async function archivePantryItem(
  client: SupabaseClient<Database>,
  input: ArchivePantryItemInput
): Promise<void> {
  const { error } = await client.rpc('archive_pantry_item', {
    p_item_id: input.itemId,
    p_event_type: input.eventType,
    p_quantity: input.quantity,
    p_triggered_by: input.userId,
  });

  if (error) throw error;
}
