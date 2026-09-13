import { addGroceryListEntry, setGroceryListEntryChecked, deleteGroceryListEntry } from './groceryList';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(handlers: {
  insertResult?: { data: any; error: any };
  updateResult?: { error: any };
  deleteResult?: { error: any };
}): SupabaseClient<Database> & { lastInsertPayload?: any; lastUpdatePayload?: any; lastEqArgs?: any[] } {
  const state: any = {};
  const from = (table: string): any => {
    if (table !== 'grocery_list_entries') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => {
        state.lastInsertPayload = payload;
        return {
          select: () => ({
            single: async () => handlers.insertResult,
          }),
        };
      },
      update: (payload: any) => {
        state.lastUpdatePayload = payload;
        return {
          eq: (...args: any[]) => {
            state.lastEqArgs = args;
            return Promise.resolve(handlers.updateResult);
          },
        };
      },
      delete: () => ({
        eq: (...args: any[]) => {
          state.lastEqArgs = args;
          return Promise.resolve(handlers.deleteResult);
        },
      }),
    };
  };
  state.from = from;
  return state;
}

describe('addGroceryListEntry', () => {
  it('inserts an entry scoped to the household and returns the created row', async () => {
    const row = { id: 'entry-1', household_id: 'house-1', name: 'Garlic', quantity: 1, unit: 'pcs', is_checked: false };
    const client = fakeClient({ insertResult: { data: row, error: null } });

    const result = await addGroceryListEntry(client, 'house-1', 'user-1', { name: 'Garlic', quantity: 1, unit: 'pcs' });

    expect(result).toEqual(row);
    expect((client as any).lastInsertPayload).toEqual({
      household_id: 'house-1',
      added_by: 'user-1',
      name: 'Garlic',
      quantity: 1,
      unit: 'pcs',
    });
  });

  it('allows omitting quantity and unit', async () => {
    const client = fakeClient({ insertResult: { data: { id: 'entry-2' }, error: null } });

    await addGroceryListEntry(client, 'house-1', 'user-1', { name: 'Salt' });

    expect((client as any).lastInsertPayload).toEqual({
      household_id: 'house-1',
      added_by: 'user-1',
      name: 'Salt',
      quantity: null,
      unit: null,
    });
  });

  it('throws when the insert errors', async () => {
    const client = fakeClient({ insertResult: { data: null, error: new Error('insert failed') } });

    await expect(addGroceryListEntry(client, 'house-1', 'user-1', { name: 'Salt' })).rejects.toThrow(
      'insert failed'
    );
  });
});

describe('setGroceryListEntryChecked', () => {
  it('updates is_checked for the given entry id', async () => {
    const client = fakeClient({ updateResult: { error: null } });

    await setGroceryListEntryChecked(client, 'entry-1', true);

    expect((client as any).lastUpdatePayload).toEqual({ is_checked: true });
    expect((client as any).lastEqArgs).toEqual(['id', 'entry-1']);
  });

  it('throws when the update errors', async () => {
    const client = fakeClient({ updateResult: { error: new Error('update failed') } });

    await expect(setGroceryListEntryChecked(client, 'entry-1', false)).rejects.toThrow('update failed');
  });
});

describe('deleteGroceryListEntry', () => {
  it('deletes the given entry id', async () => {
    const client = fakeClient({ deleteResult: { error: null } });

    await deleteGroceryListEntry(client, 'entry-1');

    expect((client as any).lastEqArgs).toEqual(['id', 'entry-1']);
  });

  it('throws when the delete errors', async () => {
    const client = fakeClient({ deleteResult: { error: new Error('delete failed') } });

    await expect(deleteGroceryListEntry(client, 'entry-1')).rejects.toThrow('delete failed');
  });
});
