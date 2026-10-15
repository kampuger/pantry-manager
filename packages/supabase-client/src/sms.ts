import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface PhoneNumberStatus {
  phoneE164: string;
  verifiedAt: string;
}

/** The caller's verified number, or null. RLS limits the table to their own row. */
export async function getMyPhoneNumber(
  client: SupabaseClient<Database>,
  userId: string
): Promise<PhoneNumberStatus | null> {
  const { data, error } = await client
    .from('user_phone_numbers')
    .select('phone_e164, verified_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { phoneE164: data.phone_e164, verifiedAt: data.verified_at };
}

export async function removeMyPhoneNumber(client: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await client.from('user_phone_numbers').delete().eq('user_id', userId);
  if (error) throw error;
}

// `functions.invoke` reports every non-2xx as a generic "Edge Function
// returned a non-2xx status code". The real reason ("wait 40 seconds", "not a
// Philippine number") is in the response body, so dig it out.
async function invokeSmsVerify<T>(client: SupabaseClient<Database>, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('sms-verify', { body });
  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const payload = (await context?.json?.()) as { error?: string } | undefined;
      if (payload?.error) message = payload.error;
    } catch {
      // The body wasn't JSON — keep the generic message.
    }
    throw new Error(message);
  }
  return data as T;
}

export async function requestPhoneVerification(client: SupabaseClient<Database>, phone: string): Promise<void> {
  await invokeSmsVerify(client, { action: 'request', phone });
}

export async function confirmPhoneVerification(
  client: SupabaseClient<Database>,
  code: string
): Promise<{ phoneE164: string }> {
  const data = await invokeSmsVerify<{ phone_e164: string }>(client, { action: 'confirm', code });
  return { phoneE164: data.phone_e164 };
}

export async function getMemberSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await client
    .from('household_members')
    .select('sms_enabled')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data.sms_enabled;
}

export async function setMemberSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  userId: string,
  enabled: boolean
): Promise<void> {
  const { data, error } = await client
    .from('household_members')
    .update({ sms_enabled: enabled })
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Failed to update your SMS setting.');
  }
}

export async function getHouseholdSmsEnabled(client: SupabaseClient<Database>, householdId: string): Promise<boolean> {
  const { data, error } = await client.from('households').select('sms_enabled').eq('id', householdId).single();
  if (error) throw error;
  return data.sms_enabled;
}

export async function setHouseholdSmsEnabled(
  client: SupabaseClient<Database>,
  householdId: string,
  enabled: boolean
): Promise<void> {
  // `.select()` matters: RLS restricts households UPDATE to owners/admins, and
  // an update that matches zero rows comes back as { data: [], error: null }.
  const { data, error } = await client
    .from('households')
    .update({ sms_enabled: enabled })
    .eq('id', householdId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('You do not have permission to change SMS settings for this household.');
  }
}

/**
 * Whether the platform admin has SMS switched on app-wide. `app_settings` is
 * readable by platform admins only, so members learn this through a
 * security-definer function that exposes just that one boolean.
 */
export async function getSmsAvailable(client: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await client.rpc('sms_available', {});
  if (error) throw error;
  return data === true;
}
