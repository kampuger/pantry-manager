import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  grantAdmin,
  revokeAdmin,
} from './platformAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

describe('checkIsPlatformAdmin', () => {
  it('returns true when the RPC reports the caller is an admin', async () => {
    const rpc = jest.fn(async () => ({ data: true, error: null }));
    const client = { rpc } as unknown as SupabaseClient<Database>;

    expect(await checkIsPlatformAdmin(client)).toBe(true);
    expect(rpc).toHaveBeenCalledWith('is_platform_admin', {});
  });

  it('returns false when the RPC reports the caller is not an admin', async () => {
    const client = { rpc: jest.fn(async () => ({ data: false, error: null })) } as unknown as SupabaseClient<Database>;
    expect(await checkIsPlatformAdmin(client)).toBe(false);
  });

  it('throws when the RPC errors', async () => {
    const client = { rpc: jest.fn(async () => ({ data: null, error: new Error('boom') })) } as unknown as SupabaseClient<Database>;
    await expect(checkIsPlatformAdmin(client)).rejects.toThrow('boom');
  });
});

describe('listAllUsers', () => {
  it('invokes admin-manage-users with the list_users action and returns the users array', async () => {
    const users = [{ id: 'u1', email: 'a@example.com', createdAt: '2026-09-01', bannedUntil: null, isAdmin: true }];
    const invoke = jest.fn(async () => ({ data: { status: 'ok', users }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    expect(await listAllUsers(client)).toEqual(users);
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', { body: { action: 'list_users' } });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('403 Forbidden') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(listAllUsers(client)).rejects.toThrow('403 Forbidden');
  });

  it('surfaces the server-provided message from a FunctionsHttpError context, not the generic supabase-js message', async () => {
    const fakeResponse = {
      clone() {
        return this;
      },
      json: async () => ({ status: 'error', message: 'already registered' }),
    };
    const httpError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: fakeResponse,
    });
    const invoke = jest.fn(async () => ({ data: null, error: httpError }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await expect(inviteUser(client, 'dup@example.com')).rejects.toThrow('already registered');
  });

  it('throws a clean error when the function returns no data and no error', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await expect(listAllUsers(client)).rejects.toThrow('Unexpected response from admin-manage-users');
  });
});

describe('inviteUser', () => {
  it('invokes admin-manage-users with the invite_user action and email', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await inviteUser(client, 'new@example.com');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'invite_user', email: 'new@example.com' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('already registered') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(inviteUser(client, 'dup@example.com')).rejects.toThrow('already registered');
  });
});

describe('suspendUser / unsuspendUser', () => {
  it('invokes admin-manage-users with suspend_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await suspendUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'suspend_user', targetUserId: 'user-2' },
    });
  });

  it('invokes admin-manage-users with unsuspend_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await unsuspendUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'unsuspend_user', targetUserId: 'user-2' },
    });
  });

  it('throws when the function call errors', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('cannot suspend your own account') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(suspendUser(client, 'self-id')).rejects.toThrow('cannot suspend your own account');
  });
});

describe('deleteUser', () => {
  it('invokes admin-manage-users with delete_user and the target id', async () => {
    const invoke = jest.fn(async () => ({ data: { status: 'ok' }, error: null }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await deleteUser(client, 'user-2');
    expect(invoke).toHaveBeenCalledWith('admin-manage-users', {
      body: { action: 'delete_user', targetUserId: 'user-2' },
    });
  });

  it('throws with the households-restrict-violation message when the function reports one', async () => {
    const invoke = jest.fn(async () => ({
      data: null,
      error: new Error(
        "This user created a household and can't be deleted while it still exists — delete that household first, or reassign it, then try again."
      ),
    }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(deleteUser(client, 'user-3')).rejects.toThrow('household');
  });

  it('throws when the function call errors for any other reason', async () => {
    const invoke = jest.fn(async () => ({ data: null, error: new Error('Cannot delete your own account') }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;
    await expect(deleteUser(client, 'self-id')).rejects.toThrow('Cannot delete your own account');
  });
});

describe('grantAdmin / revokeAdmin', () => {
  function fakeClient(handlers: { insertResult?: { error: any }; deleteResult?: { error: any } }) {
    const state: any = {};
    state.from = (table: string): any => {
      if (table !== 'platform_admins') throw new Error(`Unexpected table: ${table}`);
      return {
        insert: (payload: any) => {
          state.lastInsertPayload = payload;
          return Promise.resolve(handlers.insertResult);
        },
        delete: () => ({
          eq: (...args: any[]) => {
            state.lastEqArgs = args;
            return Promise.resolve(handlers.deleteResult);
          },
        }),
      };
    };
    return state as SupabaseClient<Database> & { lastInsertPayload?: any; lastEqArgs?: any[] };
  }

  it('grantAdmin inserts a row with user_id and granted_by', async () => {
    const client = fakeClient({ insertResult: { error: null } });
    await grantAdmin(client, 'user-2', 'admin-1');
    expect(client.lastInsertPayload).toEqual({ user_id: 'user-2', granted_by: 'admin-1' });
  });

  it('grantAdmin throws when the insert errors', async () => {
    const client = fakeClient({ insertResult: { error: new Error('insert failed') } });
    await expect(grantAdmin(client, 'user-2', 'admin-1')).rejects.toThrow('insert failed');
  });

  it('revokeAdmin deletes by user_id', async () => {
    const client = fakeClient({ deleteResult: { error: null } });
    await revokeAdmin(client, 'user-2');
    expect(client.lastEqArgs).toEqual(['user_id', 'user-2']);
  });

  it('revokeAdmin throws when the delete errors', async () => {
    const client = fakeClient({ deleteResult: { error: new Error('cannot remove the last remaining platform admin') } });
    await expect(revokeAdmin(client, 'user-2')).rejects.toThrow('cannot remove the last remaining platform admin');
  });
});
