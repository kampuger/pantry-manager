import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import {
  confirmPhoneVerification,
  getHouseholdSmsEnabled,
  getMemberSmsEnabled,
  getMyPhoneNumber,
  removeMyPhoneNumber,
  requestPhoneVerification,
  setHouseholdSmsEnabled,
  setMemberSmsEnabled,
} from './sms';

type Result = { data: any; error: any };

// A chainable stand-in for the PostgREST builder: every method returns the
// builder, and awaiting it (or calling .single()/.maybeSingle()) yields the
// canned result. Records each call so tests can assert the query shape.
function fakeClient(result: Result) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = [];
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, unknown[]][] };
      calls.push(entry);
      const builder: any = {};
      for (const op of ['select', 'update', 'delete', 'eq']) {
        builder[op] = (...args: unknown[]) => {
          entry.ops.push([op, args]);
          return builder;
        };
      }
      builder.single = async () => result;
      builder.maybeSingle = async () => result;
      builder.then = (resolve: (value: Result) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('getMyPhoneNumber', () => {
  it('maps the row, or returns null when there is no number', async () => {
    const { client } = fakeClient({
      data: { phone_e164: '+639171234567', verified_at: '2026-10-15T00:00:00Z' },
      error: null,
    });
    expect(await getMyPhoneNumber(client, 'user-1')).toEqual({
      phoneE164: '+639171234567',
      verifiedAt: '2026-10-15T00:00:00Z',
    });
    expect(await getMyPhoneNumber(fakeClient({ data: null, error: null }).client, 'user-1')).toBeNull();
  });

  it('throws on a query error', async () => {
    await expect(getMyPhoneNumber(fakeClient({ data: null, error: new Error('boom') }).client, 'u')).rejects.toThrow('boom');
  });
});

describe('removeMyPhoneNumber', () => {
  it('deletes only the caller’s row', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await removeMyPhoneNumber(client, 'user-1');
    expect(calls[0].table).toBe('user_phone_numbers');
    expect(calls[0].ops).toContainEqual(['eq', ['user_id', 'user-1']]);
    expect(calls[0].ops.some(([op]) => op === 'delete')).toBe(true);
  });
});

describe('phone verification calls', () => {
  function invokeClient(response: { data: any; error: any }) {
    const invoke = jest.fn(async () => response);
    return { client: { functions: { invoke } } as unknown as SupabaseClient<Database>, invoke };
  }

  it('requests a code through the sms-verify function', async () => {
    const { client, invoke } = invokeClient({ data: { status: 'sent' }, error: null });
    await requestPhoneVerification(client, '09171234567');
    expect(invoke).toHaveBeenCalledWith('sms-verify', { body: { action: 'request', phone: '09171234567' } });
  });

  it('confirms a code and returns the verified number', async () => {
    const { client, invoke } = invokeClient({
      data: { status: 'verified', phone_e164: '+639171234567' },
      error: null,
    });
    expect(await confirmPhoneVerification(client, '123456')).toEqual({ phoneE164: '+639171234567' });
    expect(invoke).toHaveBeenCalledWith('sms-verify', { body: { action: 'confirm', code: '123456' } });
  });

  it('surfaces the server’s error message instead of the generic one', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { json: async () => ({ error: 'Please wait 40 seconds before requesting another code.' }) },
    });
    const { client } = invokeClient({ data: null, error });
    await expect(requestPhoneVerification(client, '09171234567')).rejects.toThrow(
      'Please wait 40 seconds before requesting another code.'
    );
  });

  it('falls back to the generic message when the error body is not JSON', async () => {
    const error = Object.assign(new Error('generic failure'), {
      context: {
        json: async () => {
          throw new Error('not json');
        },
      },
    });
    const { client } = invokeClient({ data: null, error });
    await expect(confirmPhoneVerification(client, '123456')).rejects.toThrow('generic failure');
  });
});

describe('member and household SMS switches', () => {
  it('reads the member switch', async () => {
    const { client, calls } = fakeClient({ data: { sms_enabled: true }, error: null });
    expect(await getMemberSmsEnabled(client, 'house-1', 'user-1')).toBe(true);
    expect(calls[0].table).toBe('household_members');
  });

  it('writes the member switch and fails when no row was updated', async () => {
    const ok = fakeClient({ data: [{ id: 'm1' }], error: null });
    await setMemberSmsEnabled(ok.client, 'house-1', 'user-1', true);
    expect(ok.calls[0].ops).toContainEqual(['update', [{ sms_enabled: true }]]);

    const none = fakeClient({ data: [], error: null });
    await expect(setMemberSmsEnabled(none.client, 'house-1', 'user-1', true)).rejects.toThrow(
      'Failed to update your SMS setting.'
    );
  });

  it('reads the household switch', async () => {
    const { client, calls } = fakeClient({ data: { sms_enabled: false }, error: null });
    expect(await getHouseholdSmsEnabled(client, 'house-1')).toBe(false);
    expect(calls[0].table).toBe('households');
  });

  it('writes the household switch and reports a permission failure when RLS filters it out', async () => {
    const ok = fakeClient({ data: [{ id: 'h1' }], error: null });
    await setHouseholdSmsEnabled(ok.client, 'house-1', true);
    expect(ok.calls[0].ops).toContainEqual(['update', [{ sms_enabled: true }]]);

    const none = fakeClient({ data: [], error: null });
    await expect(setHouseholdSmsEnabled(none.client, 'house-1', true)).rejects.toThrow(
      'You do not have permission to change SMS settings for this household.'
    );
  });
});
