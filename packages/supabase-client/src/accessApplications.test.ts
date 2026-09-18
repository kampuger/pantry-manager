import {
  submitApplication,
  listPendingApplications,
  markApplicationApproved,
  markApplicationRejected,
} from './accessApplications';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

function fakeClient(handlers: {
  insertResult?: { error: any };
  selectResult?: { data: any; error: any };
  updateResult?: { error: any };
}) {
  const state: any = {};
  state.from = (table: string): any => {
    if (table !== 'access_applications') throw new Error(`Unexpected table: ${table}`);
    return {
      insert: (payload: any) => {
        state.lastInsertPayload = payload;
        return Promise.resolve(handlers.insertResult);
      },
      select: (columns: string) => {
        state.lastSelectColumns = columns;
        return {
          eq: (...eqArgs: any[]) => ({
            order: (...orderArgs: any[]) => {
              state.lastEqArgs = eqArgs;
              state.lastOrderArgs = orderArgs;
              return Promise.resolve(handlers.selectResult);
            },
          }),
        };
      },
      update: (payload: any) => {
        state.lastUpdatePayload = payload;
        return {
          eq: (...eqArgs: any[]) => {
            state.lastUpdateEqArgs = eqArgs;
            return Promise.resolve(handlers.updateResult);
          },
        };
      },
    };
  };
  return state as SupabaseClient<Database> & {
    lastInsertPayload?: any;
    lastSelectColumns?: any;
    lastEqArgs?: any[];
    lastOrderArgs?: any[];
    lastUpdatePayload?: any;
    lastUpdateEqArgs?: any[];
  };
}

describe('submitApplication', () => {
  it('inserts email and trimmed message', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '  please let me in  ');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: 'please let me in' });
  });

  it('inserts a null message when none is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: null });
  });

  it('inserts a null message when only whitespace is given', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await submitApplication(client, 'new@example.com', '   ');
    expect(client.lastInsertPayload).toEqual({ email: 'new@example.com', message: null });
  });

  it('resolves successfully on a duplicate-pending-email unique violation (code 23505)', async () => {
    const client = fakeClient({ insertResult: { error: { code: '23505', message: 'duplicate key value' } } });
    await expect(submitApplication(client, 'dup@example.com')).resolves.toBeUndefined();
  });

  it('throws on any other error', async () => {
    const client = fakeClient({ insertResult: { error: { code: '23514', message: 'check constraint violated' } } });
    await expect(submitApplication(client, 'bad@example.com')).rejects.toThrow('check constraint violated');
  });
});

describe('listPendingApplications', () => {
  it('selects pending applications ordered oldest-first and maps snake_case to camelCase', async () => {
    const rows = [
      {
        id: 'app-1',
        email: 'a@example.com',
        message: 'hi',
        status: 'pending',
        submitted_at: '2026-09-17T00:00:00.000Z',
        reviewed_at: null,
        reviewed_by: null,
      },
    ];
    const client = fakeClient({ selectResult: { data: rows, error: null } });

    expect(await listPendingApplications(client)).toEqual([
      {
        id: 'app-1',
        email: 'a@example.com',
        message: 'hi',
        status: 'pending',
        submittedAt: '2026-09-17T00:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
      },
    ]);
    expect(client.lastEqArgs).toEqual(['status', 'pending']);
    expect(client.lastOrderArgs).toEqual(['submitted_at', { ascending: true }]);
  });

  it('returns an empty array when there is no data', async () => {
    const client = fakeClient({ selectResult: { data: null, error: null } });
    expect(await listPendingApplications(client)).toEqual([]);
  });

  it('throws when the query errors', async () => {
    const client = fakeClient({ selectResult: { data: null, error: new Error('boom') } });
    await expect(listPendingApplications(client)).rejects.toThrow('boom');
  });
});

describe('markApplicationApproved', () => {
  it('updates status to approved with reviewed_at and reviewed_by, filtered by id', async () => {
    const client = fakeClient({ updateResult: { error: null } });
    await markApplicationApproved(client, 'app-1', 'admin-1');
    expect(client.lastUpdatePayload.status).toBe('approved');
    expect(client.lastUpdatePayload.reviewed_by).toBe('admin-1');
    expect(typeof client.lastUpdatePayload.reviewed_at).toBe('string');
    expect(client.lastUpdateEqArgs).toEqual(['id', 'app-1']);
  });

  it('throws when the update errors', async () => {
    const client = fakeClient({ updateResult: { error: new Error('update failed') } });
    await expect(markApplicationApproved(client, 'app-1', 'admin-1')).rejects.toThrow('update failed');
  });
});

describe('markApplicationRejected', () => {
  it('updates status to rejected with reviewed_at and reviewed_by, filtered by id', async () => {
    const client = fakeClient({ updateResult: { error: null } });
    await markApplicationRejected(client, 'app-2', 'admin-1');
    expect(client.lastUpdatePayload.status).toBe('rejected');
    expect(client.lastUpdatePayload.reviewed_by).toBe('admin-1');
    expect(typeof client.lastUpdatePayload.reviewed_at).toBe('string');
    expect(client.lastUpdateEqArgs).toEqual(['id', 'app-2']);
  });

  it('throws when the update errors', async () => {
    const client = fakeClient({ updateResult: { error: new Error('update failed') } });
    await expect(markApplicationRejected(client, 'app-2', 'admin-1')).rejects.toThrow('update failed');
  });
});
