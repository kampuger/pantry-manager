import { getMyHousehold, createHousehold, getHouseholdNotificationPrefs, updateHouseholdNotificationPrefs } from './household';
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
  function fakeClient(error: any, capture: { payload?: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'households') throw new Error(`Unexpected table: ${table}`);
      return {
        update: (payload: any) => {
          capture.payload = payload;
          return { eq: () => ({ then: (resolve: any) => Promise.resolve({ error }).then(resolve) }) };
        },
      };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('writes both preference fields', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient(null, capture);
    await updateHouseholdNotificationPrefs(client, 'house-1', { notifyDaysProduce: 3, notifyDaysNonproduce: 10 });
    expect(capture.payload).toEqual({ notify_days_produce: 3, notify_days_nonproduce: 10 });
  });

  it('throws when the update errors', async () => {
    const capture: { payload?: any } = {};
    const client = fakeClient(new Error('update failed'), capture);
    await expect(
      updateHouseholdNotificationPrefs(client, 'house-1', { notifyDaysProduce: 3, notifyDaysNonproduce: 10 })
    ).rejects.toThrow('update failed');
  });
});
