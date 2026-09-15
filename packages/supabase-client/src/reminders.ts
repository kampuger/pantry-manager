import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface PantryItemReminder {
  pantryItemId: string;
  name: string;
  expirationDate: string;
}

/**
 * Reads today's in-app notification list directly from
 * `pantry_item_reminders` — its rows ARE the notifications; there is no
 * separate read/unread state. Populated by `refresh_household_reminders()`
 * (see the `compute-and-send-reminders` Edge Function), not written here.
 */
export async function getPantryItemReminders(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<PantryItemReminder[]> {
  const { data, error } = await client
    .from('pantry_item_reminders')
    .select('pantry_item_id, pantry_items(name, expiration_date)')
    .eq('household_id', householdId);

  if (error) throw error;

  return (data ?? [])
    .filter((row: any) => row.pantry_items)
    .map((row: any) => ({
      pantryItemId: row.pantry_item_id,
      name: row.pantry_items.name,
      expirationDate: row.pantry_items.expiration_date,
    }));
}

/**
 * Calls the `compute-and-send-reminders` Edge Function directly instead of
 * waiting for the next `pg_cron` tick. The function itself checks the
 * caller's role is OWNER/ADMIN for `householdId` and rejects otherwise —
 * this client just surfaces whatever it returns.
 */
export async function triggerRemindersNow(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<{ status: string }> {
  const { data, error } = await client.functions.invoke('compute-and-send-reminders', {
    body: { household_id: householdId },
  });

  if (error) throw error;
  return data;
}
