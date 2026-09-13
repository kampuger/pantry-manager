// packages/supabase-client/src/client.test.ts
import { createSupabaseClient } from './client';

describe('createSupabaseClient', () => {
  it('throws when url is missing', () => {
    expect(() => createSupabaseClient('', 'anon-key')).toThrow(
      'Supabase URL and anon key are required'
    );
  });

  it('throws when anonKey is missing', () => {
    expect(() => createSupabaseClient('https://example.supabase.co', '')).toThrow(
      'Supabase URL and anon key are required'
    );
  });

  it('returns a client instance with a queryable .from() when given valid values', () => {
    const client = createSupabaseClient('https://example.supabase.co', 'fake-anon-key');
    expect(typeof client.from).toBe('function');
  });
});
