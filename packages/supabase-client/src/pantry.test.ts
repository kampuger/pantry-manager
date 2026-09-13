import { addPantryItem } from './pantry';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(insertResult: { data: any; error: any }): SupabaseClient<Database> {
  const from = (table: string): any => {
    if (table !== 'pantry_items') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => ({
        select: () => ({
          single: async () => {
            fakeClient.lastPayload = payload;
            return insertResult;
          },
        }),
      }),
    };
  };
  return { from } as unknown as SupabaseClient<Database>;
}
fakeClient.lastPayload = undefined as any;

describe('addPantryItem', () => {
  it('inserts a pantry item scoped to the household and returns the created row', async () => {
    const row = {
      id: 'item-1',
      household_id: 'house-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      expiration_date: '2026-09-20',
    };
    const client = fakeClient({ data: row, error: null });

    const result = await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storageLocation: 'FRIDGE',
      expirationDate: '2026-09-20',
    });

    expect(result).toEqual(row);
    expect(fakeClient.lastPayload).toEqual({
      household_id: 'house-1',
      created_by: 'user-1',
      name: 'Fresh Milk',
      quantity: 1,
      unit: 'L',
      storage_location: 'FRIDGE',
      expiration_date: '2026-09-20',
    });
  });

  it('defaults expiration_date to null when not provided', async () => {
    const client = fakeClient({ data: { id: 'item-2' }, error: null });

    await addPantryItem(client, 'house-1', 'user-1', {
      name: 'Rice',
      quantity: 2,
      unit: 'kg',
      storageLocation: 'PANTRY',
    });

    expect(fakeClient.lastPayload.expiration_date).toBeNull();
  });

  it('throws when the insert errors', async () => {
    const client = fakeClient({ data: null, error: new Error('insert failed') });

    await expect(
      addPantryItem(client, 'house-1', 'user-1', {
        name: 'Rice',
        quantity: 2,
        unit: 'kg',
        storageLocation: 'PANTRY',
      })
    ).rejects.toThrow('insert failed');
  });
});
