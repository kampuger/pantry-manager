// packages/supabase-client/src/client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export type { Database };
