import { createHouseholdInvite } from './householdInvites';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(insertResult: { data: any; error: any }) {
  const state: any = {};
  state.from = (table: string): any => {
    if (table !== 'household_invites') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => {
        state.lastInsertPayload = payload;
        return {
          select: (columns: string) => {
            state.lastSelectColumns = columns;
            return { single: async () => insertResult };
          },
        };
      },
    };
  };
  return state as SupabaseClient<Database> & { lastInsertPayload?: any; lastSelectColumns?: any };
}

const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('createHouseholdInvite', () => {
  it('inserts an 8-character code drawn from the unambiguous charset, plus household_id and created_by', async () => {
    const client = fakeClient({
      data: { id: 'inv-1', code: 'ABCD2345', expires_at: '2026-09-25T00:00:00.000Z' },
      error: null,
    });
    await createHouseholdInvite(client, 'house-1', 'user-1');
    expect(client.lastInsertPayload.household_id).toBe('house-1');
    expect(client.lastInsertPayload.created_by).toBe('user-1');
    expect(client.lastInsertPayload.code).toHaveLength(8);
    expect([...client.lastInsertPayload.code].every((c: string) => INVITE_CODE_CHARSET.includes(c))).toBe(true);
  });

  it('returns the inserted invite, mapping snake_case to camelCase', async () => {
    const client = fakeClient({
      data: { id: 'inv-1', code: 'ABCD2345', expires_at: '2026-09-25T00:00:00.000Z' },
      error: null,
    });
    expect(await createHouseholdInvite(client, 'house-1', 'user-1')).toEqual({
      id: 'inv-1',
      code: 'ABCD2345',
      expiresAt: '2026-09-25T00:00:00.000Z',
    });
  });

  it('throws when the insert errors', async () => {
    const client = fakeClient({ data: null, error: new Error('insert failed') });
    await expect(createHouseholdInvite(client, 'house-1', 'user-1')).rejects.toThrow('insert failed');
  });
});
