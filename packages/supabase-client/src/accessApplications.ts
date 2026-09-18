import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export interface AccessApplication {
  id: string;
  email: string;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const DUPLICATE_PENDING_APPLICATION_CODE = '23505';

/**
 * Inserts a pending application. If one is already pending for this email,
 * the partial unique index on access_applications(email) where status =
 * 'pending' rejects the insert with a 23505 unique-violation — from the
 * caller's perspective, "already in the queue" and "just added to the
 * queue" should look identical, so that specific error is swallowed here
 * rather than thrown.
 */
export async function submitApplication(
  client: SupabaseClient<Database>,
  email: string,
  message?: string,
  householdInviteCode?: string
): Promise<void> {
  const { error } = await client.from('access_applications').insert({
    email: email.trim().toLowerCase(),
    message: message?.trim() || null,
    household_invite_code: householdInviteCode?.trim() || null,
  });
  if (error && (error as PostgrestError).code !== DUPLICATE_PENDING_APPLICATION_CODE) {
    const err = error as any;
    const thrownError = new Error(err.message);
    Object.assign(thrownError, error);
    throw thrownError;
  }
}

/** RLS restricts this to admins already; this function adds no additional authorization logic. */
export async function listPendingApplications(client: SupabaseClient<Database>): Promise<AccessApplication[]> {
  const { data, error } = await client
    .from('access_applications')
    .select('*')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    message: row.message,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  }));
}

export async function markApplicationApproved(
  client: SupabaseClient<Database>,
  applicationId: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
    .eq('id', applicationId);
  if (error) throw error;
}

export async function markApplicationRejected(
  client: SupabaseClient<Database>,
  applicationId: string,
  reviewedBy: string
): Promise<void> {
  const { error } = await client
    .from('access_applications')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy })
    .eq('id', applicationId);
  if (error) throw error;
}

/**
 * Filters to approved applications and orders by most-recent-reviewed so a
 * user who (unusually) has more than one historical application row still
 * gets a sensible single answer. RLS independently enforces that the caller
 * can only ever see rows matching their own authenticated email, regardless
 * of what email is passed in here.
 */
export async function getMyApplicationInviteCode(
  client: SupabaseClient<Database>,
  email: string
): Promise<string | null> {
  const { data, error } = await client
    .from('access_applications')
    .select('household_invite_code')
    .eq('email', email)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.household_invite_code ?? null;
}
