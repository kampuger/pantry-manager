import {
  checkIsPlatformAdmin,
  listAllUsers,
  inviteUser,
  suspendUser,
  unsuspendUser,
  deleteUser,
  grantAdmin,
  revokeAdmin,
  getHouseholdOwnedBy,
  deleteHousehold,
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

describe('getHouseholdOwnedBy / deleteHousehold', () => {
  function fakeClient(handlers: {
    householdResult?: { data: any; error: any };
    countResult?: { count: number | null; error: any };
    deleteResult?: { error: any };
  }) {
    const state: any = {};
    state.from = (table: string): any => {
      if (table === 'households') {
        return {
          select: () => ({
            eq: (...args: any[]) => {
              state.lastHouseholdEqArgs = args;
              return { maybeSingle: async () => handlers.householdResult };
            },
          }),
          delete: () => ({
            eq: (...args: any[]) => {
              state.lastDeleteEqArgs = args;
              return Promise.resolve(handlers.deleteResult);
            },
          }),
        };
      }
      if (table === 'household_members') {
        return {
          select: (columns: string, options: any) => {
            state.lastCountSelectColumns = columns;
            state.lastCountOptions = options;
            return {
              eq: (...args: any[]) => {
                state.lastCountEqArgs = args;
                return Promise.resolve(handlers.countResult);
              },
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    };
    return state as SupabaseClient<Database> & {
      lastHouseholdEqArgs?: any[];
      lastDeleteEqArgs?: any[];
      lastCountSelectColumns?: any;
      lastCountOptions?: any;
      lastCountEqArgs?: any[];
    };
  }

  describe('getHouseholdOwnedBy', () => {
    it('returns the household with its member count when found', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'The Santos Family' }, error: null },
        countResult: { count: 3, error: null },
      });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toEqual({
        id: 'house-1',
        name: 'The Santos Family',
        memberCount: 3,
      });
      expect(client.lastHouseholdEqArgs).toEqual(['created_by', 'user-1']);
      expect(client.lastCountEqArgs).toEqual(['household_id', 'house-1']);
      expect(client.lastCountOptions).toEqual({ count: 'exact', head: true });
    });

    it('returns null when the user owns no household', async () => {
      const client = fakeClient({ householdResult: { data: null, error: null } });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toBeNull();
    });

    it('defaults memberCount to 0 when count is null', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'Empty House' }, error: null },
        countResult: { count: null, error: null },
      });
      expect(await getHouseholdOwnedBy(client, 'user-1')).toEqual({
        id: 'house-1',
        name: 'Empty House',
        memberCount: 0,
      });
    });

    it('throws when the household query errors', async () => {
      const client = fakeClient({ householdResult: { data: null, error: new Error('boom') } });
      await expect(getHouseholdOwnedBy(client, 'user-1')).rejects.toThrow('boom');
    });

    it('throws when the member count query errors', async () => {
      const client = fakeClient({
        householdResult: { data: { id: 'house-1', name: 'The Santos Family' }, error: null },
        countResult: { count: null, error: new Error('count failed') },
      });
      await expect(getHouseholdOwnedBy(client, 'user-1')).rejects.toThrow('count failed');
    });
  });

  describe('deleteHousehold', () => {
    it('deletes by household id', async () => {
      const client = fakeClient({ deleteResult: { error: null } });
      await deleteHousehold(client, 'house-1');
      expect(client.lastDeleteEqArgs).toEqual(['id', 'house-1']);
    });

    it('throws when the delete errors', async () => {
      const client = fakeClient({ deleteResult: { error: new Error('permission denied') } });
      await expect(deleteHousehold(client, 'house-1')).rejects.toThrow('permission denied');
    });
  });
});
