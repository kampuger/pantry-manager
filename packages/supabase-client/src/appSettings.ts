import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AppSettings {
  emailNotificationsEnabled: boolean;
}

/** App-wide settings, readable/writable by platform admins only (see app_settings RLS policies). */
export async function getAppSettings(client: SupabaseClient<Database>): Promise<AppSettings> {
  const { data, error } = await client.from('app_settings').select('email_notifications_enabled').single();
  if (error) throw error;
  return { emailNotificationsEnabled: data.email_notifications_enabled };
}

export async function setEmailNotificationsEnabled(
  client: SupabaseClient<Database>,
  enabled: boolean,
  updatedBy: string
): Promise<void> {
  // `.select()` matters here for the same reason it does in
  // updateHouseholdNotificationPrefs/deleteHousehold: RLS can silently
  // filter an update down to zero affected rows (unauthorized caller),
  // which comes back as { data: null, error: null } — a false "success"
  // the UI would otherwise report as done.
  const { data, error } = await client
    .from('app_settings')
    .update({ email_notifications_enabled: enabled, updated_by: updatedBy, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Setting was not updated — you do not have permission.');
  }
}
