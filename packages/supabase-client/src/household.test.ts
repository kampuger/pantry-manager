import {
  getMyHousehold,
  createHousehold,
  redeemHouseholdInvite,
  getHouseholdNotificationPrefs,
  updateHouseholdNotificationPrefs,
  getMemberNotificationsEnabled,
  setMemberNotificationsEnabled,
} from './household';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(handlers: {
  household_members?: { maybeSingle: () => Promise<{ data: any; error: any }> };
  households?: { insert: () => Promise<{ data: any; error: any }> };
  household_members_insert?: () => Promise<{ data: any; error: any }>;
}): SupabaseClient<Database> {
  const from = (table: string): any => {
    if (table === 'household_members' && (handlers.household_members || handlers.household_members_insert)) {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: handlers.household_members!.maybeSingle,
            }),
          }),
        }),
        insert: () => ({
          then: (resolve: any) => Promise.resolve(handlers.household_members_insert!()).then(resolve),
        }),
      };
    }
    if (table === 'households' && handlers.households) {
      return {
        insert: () => ({
          select: () => ({
            single: handlers.households!.insert,
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in fake client: ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe('getMyHousehold', () => {
  it('returns null when the user has no household membership', async () => {
    const client = fakeClient({
      household_members: { maybeSingle: async () => ({ data: null, error: null }) },
    });
    expect(await getMyHousehold(client, 'user-1')).toBeNull();
  });

  it('returns the membership when found', async () => {
    const client = fakeClient({
      household_members: {
        maybeSingle: async () => ({
          data: { household_id: 'house-1', role: 'OWNER' },
          error: null,
        }),
      },
    });
    expect(await getMyHousehold(client, 'user-1')).toEqual({
      householdId: 'house-1',
      role: 'OWNER',
    });
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({
      household_members: {
        maybeSingle: async () => ({ data: null, error: new Error('boom') }),
      },
    });
    await expect(getMyHousehold(client, 'user-1')).rejects.toThrow('boom');
  });
});

describe('createHousehold', () => {
  it('creates a household then adds the creator as OWNER', async () => {
    const client = fakeClient({
      households: {
        insert: async () => ({ data: { id: 'house-2' }, error: null }),
      },
      household_members_insert: async () => ({ data: null, error: null }),
    });
    expect(await createHousehold(client, 'user-1', 'My Household')).toEqual({
      householdId: 'house-2',
      role: 'OWNER',
    });
  });

  it('throws if the household insert fails', async () => {
    const client = fakeClient({
      households: {
        insert: async () => ({ data: null, error: new Error('household insert failed') }),
      },
    });
    await expect(createHousehold(client, 'user-1', 'My Household')).rejects.toThrow(
      'household insert failed'
    );
  });

  it('throws if the membership insert fails', async () => {
    const client = fakeClient({
      households: {
        insert: async () => ({ data: { id: 'house-3' }, error: null }),
      },
      household_members_insert: async () => ({ data: null, error: new Error('member insert failed') }),
    });
    await expect(createHousehold(client, 'user-1', 'My Household')).rejects.toThrow(
      'member insert failed'
    );
  });
});

describe('redeemHouseholdInvite', () => {
  function fakeClient(result: { data: any; error: any }) {
    const rpc = jest.fn(async () => result);
    return { rpc } as unknown as SupabaseClient<Database> & { rpc: jest.Mock };
  }

  it('calls the redeem_household_invite RPC and returns a MEMBER membership', async () => {
    const client = fakeClient({ data: 'house-9', error: null });
    expect(await redeemHouseholdInvite(client, 'ABCD2345')).toEqual({
      householdId: 'house-9',
      role: 'MEMBER',
    });
    expect(client.rpc).toHaveBeenCalledWith('redeem_household_invite', { invite_code: 'ABCD2345' });
  });

  it('trims and uppercases the code before calling the RPC', async () => {
    const client = fakeClient({ data: 'house-9', error: null });
    await redeemHouseholdInvite(client, '  abcd2345  ');
    expect(client.rpc).toHaveBeenCalledWith('redeem_household_invite', { invite_code: 'ABCD2345' });
  });

  it('throws with the RPC error message on failure', async () => {
    const client = fakeClient({
      data: null,
      error: new Error('This invite code is invalid, expired, or already used.'),
    });
    await expect(redeemHouseholdInvite(client, 'BADCODE1')).rejects.toThrow(
      'This invite code is invalid, expired, or already used.'
    );
  });
});

describe('getHouseholdNotificationPrefs', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => result }) }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('returns the household notification defaults', async () => {
    const client = fakeClient({ data: { notify_days_produce: 2, notify_days_nonproduce: 7 }, error: null });
    expect(await getHouseholdNotificationPrefs(client, 'house-1')).toEqual({
      notifyDaysProduce: 2,
      notifyDaysNonproduce: 7,
    });
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getHouseholdNotificationPrefs(client, 'house-1')).rejects.toThrow('boom');
  });
});

describe('updateHouseholdNotificationPrefs', () => {
  function fakeClient(
    result: { data: any; error: any },
    capture: { payload?: any }
  ): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return {
            eq: () => ({
              select: () => ({ then: (resolve: any) => Promise.resolve(result).then(resolve) }),
            }),
          };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes both preference fields', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [{ id: 'house-1' }], error: null }, capture);
    await updateHouseholdNotificationPrefs(client, 'house-1', {
      notifyDaysProduce: 3,
      notifyDaysNonproduce: 10,
      emailSendTime: '08:00:00',
      emailIntro: null,
    });
    expect(capture.payload).toEqual({
      notify_days_produce: 3,
      notify_days_nonproduce: 10,
      notify_email_send_time: '08:00:00',
      notify_email_intro: null,
    });
  });

  it('throws when the update errors', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: null, error: new Error('update failed') }, capture);
    await expect(
      updateHouseholdNotificationPrefs(client, 'house-1', {
        notifyDaysProduce: 3,
        notifyDaysNonproduce: 10,
        emailSendTime: '08:00:00',
        emailIntro: null,
      })
    ).rejects.toThrow('update failed');
  });

  it('throws when RLS silently matches zero rows (non-admin member)', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [], error: null }, capture);
    await expect(
      updateHouseholdNotificationPrefs(client, 'house-1', {
        notifyDaysProduce: 3,
        notifyDaysNonproduce: 10,
        emailSendTime: '08:00:00',
        emailIntro: null,
      })
    ).rejects.toThrow('You do not have permission to update notification preferences.');
  });
});

describe('getHouseholdNotificationPrefs (email fields)', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return { select: () => ({ eq: () => ({ single: async () => result }) }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('includes the email send time and intro text', async () => {
    const client = fakeClient({
      data: {
        notify_days_produce: 2,
        notify_days_nonproduce: 7,
        notify_email_send_time: '08:00:00',
        notify_email_intro: 'Hey team!',
      },
      error: null,
    });
    expect(await getHouseholdNotificationPrefs(client, 'house-1')).toEqual({
      notifyDaysProduce: 2,
      notifyDaysNonproduce: 7,
      emailSendTime: '08:00:00',
      emailIntro: 'Hey team!',
    });
  });
});

describe('updateHouseholdNotificationPrefs (email fields)', () => {
  function fakeClient(
    result: { data: any; error: any },
    capture: { payload?: any }
  ): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return {
            eq: () => ({
              select: () => ({ then: (resolve: any) => Promise.resolve(result).then(resolve) }),
            }),
          };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes all four preference fields', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [{ id: 'house-1' }], error: null }, capture);
    await updateHouseholdNotificationPrefs(client, 'house-1', {
      notifyDaysProduce: 3,
      notifyDaysNonproduce: 10,
      emailSendTime: '09:30',
      emailIntro: 'Reminder!',
    });
    expect(capture.payload).toEqual({
      notify_days_produce: 3,
      notify_days_nonproduce: 10,
      notify_email_send_time: '09:30',
      notify_email_intro: 'Reminder!',
    });
  });
});

describe('getMemberNotificationsEnabled', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'household_members') throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({ eq: () => ({ single: async () => result }) }),
        }),
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('returns the member row flag', async () => {
    const client = fakeClient({ data: { notifications_enabled: false }, error: null });
    expect(await getMemberNotificationsEnabled(client, 'house-1', 'user-1')).toBe(false);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getMemberNotificationsEnabled(client, 'house-1', 'user-1')).rejects.toThrow('boom');
  });
});

describe('setMemberNotificationsEnabled', () => {
  function fakeClient(
    result: { data: any; error: any },
    capture: { payload?: any }
  ): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'household_members') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({ then: (resolve: any) => Promise.resolve(result).then(resolve) }),
              }),
            }),
          };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes the flag for the caller\'s own membership row', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [{ id: 'member-1' }], error: null }, capture);
    await setMemberNotificationsEnabled(client, 'house-1', 'user-1', false);
    expect(capture.payload).toEqual({ notifications_enabled: false });
  });

  it('throws when the update matches zero rows', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient({ data: [], error: null }, capture);
    await expect(setMemberNotificationsEnabled(client, 'house-1', 'user-1', false)).rejects.toThrow(
      'Failed to update your notification setting.'
    );
  });
});
