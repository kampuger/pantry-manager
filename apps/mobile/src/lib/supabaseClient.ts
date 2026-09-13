import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSupabaseClient } from '@pantry/supabase-client';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill in your project values.'
  );
}

// AsyncStorage is required here: there is no browser localStorage on React
// Native, so without an explicit storage adapter supabase-js silently falls
// back to in-memory-only sessions that don't survive an app restart.
export const supabase = createSupabaseClient(url, anonKey, { storage: AsyncStorage });
