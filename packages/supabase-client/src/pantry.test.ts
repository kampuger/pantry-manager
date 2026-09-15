import { addPantryItem, updatePantryItem, archivePantryItem } from './pantry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakePantryClient(config: {
  insert?: (payload: any) => Promise<{ data: any; error: any }>;
  update?: (payload: any, id: string) => Promise<{ data: any; error: any }>;
  rpc?: (fn: string, args: any) => Promise<{ data: any; error: any }>;
}): SupabaseClient<Database> & { lastPayload: any; lastRpc: any } {
  const client: any = { lastPayload: undefined, lastRpc: undefined };
  client.from = (table: string): any => {
    if (table === 'pantry_items') {
      return {
        insert: (payload: any) => {
          client.lastPayload = payload;
          return { select: () => ({ single: async () => config.insert!(payload) }) };
        },
        update: (payload: any) => {
          client.lastPayload = payload;
          return {
            eq: (_col: string, id: string) => ({
              select: () => ({ single: async () => config.update!(payload, id) }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  client.rpc = (fn: string, args: any) => {
    client.lastRpc = { fn, args };
    const resultPromise = config.rpc!(fn, args);
    return { then: (resolve: any) => resultPromise.then(resolve) };
  };
  return client;
}

describe('addPantryItem', () => {
  it('inserts a pantry item scoped to the household and returns the created row', async () => {
    const row = {
      id: 'item-1',
      household_id: 'house-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      is_produce: true,
      expiration_date: '2026-09-20',
    };
    const client = fakePantryClient({ insert: async () => ({ data: row, error: null }) });

    const result = await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storageLocation: 'FRIDGE',
      isProduce: true,
      expirationDate: '2026-09-20',
    });

    expect(result).toEqual(row);
    expect(client.lastPayload).toMatchObject({
      household_id: 'house-1',
      created_by: 'user-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      is_produce: true,
      expiration_date: '2026-09-20',
      notify_days_before_expiry: null,
    });
    expect(client.lastPayload.purchase_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults expiration_date and notify override to null when not provided', async () => {
    const client = fakePantryClient({ insert: async () => ({ data: { id: 'item-2' }, error: null }) });

    await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Rice',
      quantity: 2,
      unit: 'kg',
      storageLocation: 'PANTRY',
      isProduce: false,
    });

    expect(client.lastPayload.expiration_date).toBeNull();
    expect(client.lastPayload.notify_days_before_expiry).toBeNull();
  });

  it('throws when the insert errors', async () => {
    const client = fakePantryClient({ insert: async () => ({ data: null, error: new Error('insert failed') }) });

    await expect(
      addPantryItem(client, 'house-1', 'user-1', {
        name: 'Rice',
        quantity: 2,
        unit: 'kg',
        storageLocation: 'PANTRY',
        isProduce: false,
      })
    ).rejects.toThrow('insert failed');
  });
});

describe('updatePantryItem', () => {
  it('sends only the provided fields and returns the updated row', async () => {
    const row = { id: 'item-1', name: 'Whole Milk', is_produce: false };
    const client = fakePantryClient({ update: async () => ({ data: row, error: null }) });

    const result = await updatePantryItem(client, 'item-1', { name: 'Whole Milk', isProduce: false });

    expect(result).toEqual(row);
    expect(client.lastPayload).toEqual({ name: 'Whole Milk', is_produce: false });
  });

  it('throws when the update errors', async () => {
    const client = fakePantryClient({ update: async () => ({ data: null, error: new Error('update failed') }) });

    await expect(updatePantryItem(client, 'item-1', { name: 'x' })).rejects.toThrow('update failed');
  });
});

describe('archivePantryItem', () => {
  it('archives the item and logs the movement event in one atomic rpc call', async () => {
    const client = fakePantryClient({ rpc: async () => ({ data: null, error: null }) });

    await archivePantryItem(client, {
      itemId: 'item-1',
      householdId: 'house-1',
      quantity: 2,
      eventType: 'CONSUMED',
      userId: 'user-1',
    });

    expect(client.lastRpc).toEqual({
      fn: 'archive_pantry_item',
      args: {
        p_item_id: 'item-1',
        p_event_type: 'CONSUMED',
        p_quantity: 2,
        p_triggered_by: 'user-1',
      },
    });
  });

  it('passes the discard event type through', async () => {
    const client = fakePantryClient({ rpc: async () => ({ data: null, error: null }) });

    await archivePantryItem(client, {
      itemId: 'item-2',
      householdId: 'house-1',
      quantity: 1,
      eventType: 'SPOILED_DISCARDED',
      userId: 'user-1',
    });

    expect(client.lastRpc.args.p_event_type).toBe('SPOILED_DISCARDED');
  });

  it('throws when the rpc returns an error', async () => {
    const client = fakePantryClient({
      rpc: async () => ({ data: null, error: new Error('archive failed') }),
    });

    await expect(
      archivePantryItem(client, {
        itemId: 'item-1',
        householdId: 'house-1',
        quantity: 1,
        eventType: 'CONSUMED',
        userId: 'user-1',
      })
    ).rejects.toThrow('archive failed');
  });
});
