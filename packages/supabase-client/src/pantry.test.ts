import { addPantryItem, updatePantryItem } from './pantry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakePantryClient(config: {
  insert?: (payload: any) => Promise<{ data: any; error: any }>;
  update?: (payload: any, id: string) => Promise<{ data: any; error: any }>;
  updateNoSelect?: (payload: any, id: string) => Promise<{ error: any }>;
  logInsert?: (payload: any) => Promise<{ error: any }>;
}): SupabaseClient<Database> & { lastPayload: any; lastLogPayload: any } {
  const client: any = { lastPayload: undefined, lastLogPayload: undefined };
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
            eq: (_col: string, id: string) => {
              if (config.updateNoSelect) {
                const resultPromise = config.updateNoSelect(payload, id);
                return { then: (resolve: any) => resultPromise.then(resolve) };
              }
              return { select: () => ({ single: async () => config.update!(payload, id) }) };
            },
          };
        },
      };
    }
    if (table === 'inventory_movement_logs') {
      return {
        insert: (payload: any) => {
          client.lastLogPayload = payload;
          const resultPromise = config.logInsert!(payload);
          return { then: (resolve: any) => resultPromise.then(resolve) };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
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
