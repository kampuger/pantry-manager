import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface HouseholdInvite {
  id: string;
  code: string;
  expiresAt: string;
}

// Uppercase alphanumeric, excluding 0/O/1/I to avoid visual ambiguity when a
// person reads or types the code back — matches this codebase's preference
// for plain, human-typeable values over opaque identifiers wherever a
// person handles one directly.
const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARSET[Math.floor(Math.random() * INVITE_CODE_CHARSET.length)];
  }
  return code;
}

/**
 * On the (extremely unlikely) chance of a code collision against the
 * table's `unique` constraint, the insert fails and the caller sees a
 * normal "try again" error — no retry loop.
 */
export async function createHouseholdInvite(
  client: SupabaseClient<Database>,
  householdId: string,
  createdBy: string
): Promise<HouseholdInvite> {
  const { data, error } = await client
    .from('household_invites')
    .insert({ household_id: householdId, code: generateInviteCode(), created_by: createdBy })
    .select('id, code, expires_at')
    .single();

  if (error) throw error;
  return { id: data.id, code: data.code, expiresAt: data.expires_at };
}
