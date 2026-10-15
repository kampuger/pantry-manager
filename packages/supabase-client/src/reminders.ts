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

export interface ReminderRunResult {
  status: string;
  sms?: { status: string };
}

/**
 * Calls the `compute-and-send-reminders` Edge Function directly instead of
 * waiting for the next `pg_cron` tick. The function itself checks the
 * caller's role is OWNER/ADMIN for `householdId` and rejects otherwise —
 * this client just surfaces whatever it returns.
 *
 * The function answers 502 when email failed even if SMS went out, and
 * `functions.invoke` turns every non-2xx into an error that hides the body.
 * When that body is a real run result (it has a `status`), return it so the
 * caller can report both channels; any other failure (403, 401, a plain-text
 * body) still throws.
 */
export async function triggerRemindersNow(
  client: SupabaseClient<Database>,
  householdId: string
): Promise<ReminderRunResult> {
  const { data, error } = await client.functions.invoke('compute-and-send-reminders', {
    body: { household_id: householdId },
  });

  if (error) {
    try {
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const payload = (await context?.json?.()) as ReminderRunResult | undefined;
      if (payload && typeof payload.status === 'string' && payload.status !== 'error') return payload;
    } catch {
      // Body wasn't JSON — fall through and throw the original error.
    }
    throw error;
  }
  return data;
}

/** One line for the "Send reminders now" button: email and texts reported separately. */
export function summarizeReminderRun(result: ReminderRunResult): string {
  const email = result.status;
  const sms = result.sms?.status;
  const parts: string[] = [];

  if (email === 'no_eligible_items') return 'Nothing to send — no items are expiring soon.';
  if (email === 'sent') parts.push('Email sent.');
  else if (email === 'already_sent_today') parts.push('Email was already sent today.');
  else if (email === 'send_failed') parts.push('Email failed to send.');
  else if (email === 'no_opted_in_members') parts.push('No one has email notifications on.');
  else if (email === 'disabled_globally') parts.push('Email is turned off app-wide.');
  else parts.push(`Email: ${email}.`);

  if (sms === 'sent') parts.push('Text messages sent.');
  else if (sms === 'send_failed') parts.push('Some text messages failed — try again.');
  else if (sms === 'nothing_to_send') parts.push('No text messages to send (already sent, or no verified numbers).');
  else if (sms === 'no_opted_in_members') parts.push('No one has opted in to text messages.');
  else if (sms === 'sms_not_configured') parts.push('The SMS gateway is not configured.');
  else if (sms === 'error') parts.push('Text messages hit an error.');

  return parts.join(' ');
}
