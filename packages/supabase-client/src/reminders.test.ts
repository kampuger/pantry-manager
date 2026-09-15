import { getPantryItemReminders, triggerRemindersNow } from './reminders';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

describe('getPantryItemReminders', () => {
  function fakeClient(result: { data: any; error: any }): SupabaseClient<Database> {
    const from = (table: string): any => {
      if (table !== 'pantry_item_reminders') throw new Error(`Unexpected table: ${table}`);
      // `.eq(...)` itself must be the awaitable (matches the real
      // PostgrestFilterBuilder, which is thenable) — an extra function
      // wrapper here would make `await client.from(...).select(...).eq(...)`
      // resolve to a function object instead of `{ data, error }`.
      return { select: () => ({ eq: async () => result }) };
    };
    return { from } as unknown as SupabaseClient<Database>;
  }

  it('maps embedded pantry item rows into a flat reminder list', async () => {
    const client = fakeClient({
      data: [
        { pantry_item_id: 'item-1', pantry_items: { name: 'Milk', expiration_date: '2026-09-18' } },
        { pantry_item_id: 'item-2', pantry_items: { name: 'Eggs', expiration_date: '2026-09-20' } },
      ],
      error: null,
    });
    expect(await getPantryItemReminders(client, 'house-1')).toEqual([
      { pantryItemId: 'item-1', name: 'Milk', expirationDate: '2026-09-18' },
      { pantryItemId: 'item-2', name: 'Eggs', expirationDate: '2026-09-20' },
    ]);
  });

  it('skips rows whose pantry item was deleted out from under the join', async () => {
    const client = fakeClient({
      data: [{ pantry_item_id: 'item-1', pantry_items: null }],
      error: null,
    });
    expect(await getPantryItemReminders(client, 'house-1')).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ data: null, error: new Error('boom') });
    await expect(getPantryItemReminders(client, 'house-1')).rejects.toThrow('boom');
  });
});

describe('triggerRemindersNow', () => {
  it('invokes the compute-and-send-reminders Edge Function with the household id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'sent' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    expect(await triggerRemindersNow(client, 'house-1')).toEqual({ status: 'sent' });
    expect(invoke).toHaveBeenCalledWith('compute-and-send-reminders', {
      body: { household_id: 'house-1' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('403 Forbidden') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await expect(triggerRemindersNow(client, 'house-1')).rejects.toThrow('403 Forbidden');
  });
});
