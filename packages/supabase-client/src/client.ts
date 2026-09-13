// packages/supabase-client/src/client.ts
import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js';
import type { Database } from './types';

export interface CreateSupabaseClientOptions {
  /**
   * Storage adapter for persisting the auth session. Required on React Native
   * (pass an AsyncStorage-backed adapter) since there is no browser localStorage
   * to fall back to — without it, sessions silently do not survive an app restart.
   * Omit on web to use supabase-js's default (browser localStorage).
   */
  storage?: SupportedStorage;
}

export function createSupabaseClient(
  url: string,
  anonKey: string,
  options: CreateSupabaseClientOptions = {}
): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(options.storage ? { storage: options.storage } : {}),
    },
  });
}

export type { Database };
