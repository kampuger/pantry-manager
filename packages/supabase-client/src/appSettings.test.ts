import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { getAppSettings, setEmailNotificationsEnabled, setSmsNotificationsEnabled } from './appSettings';

function updateClient(result: { data: any; error: any }) {
  const update = jest.fn();
  const builder: any = {
    update: (patch: unknown) => {
      update(patch);
      return builder;
    },
    eq: () => builder,
    select: async () => result,
  };
  return { client: { from: () => builder } as unknown as SupabaseClient<Database>, update };
}

describe('getAppSettings', () => {
  it('maps both switches', async () => {
    const client = {
      from: () => ({
        select: () => ({
          single: async () => ({
            data: { email_notifications_enabled: true, sms_notifications_enabled: false },
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;
    expect(await getAppSettings(client)).toEqual({ emailNotificationsEnabled: true, smsNotificationsEnabled: false });
  });
});

describe('setSmsNotificationsEnabled', () => {
  it('updates only the SMS column and stamps who changed it', async () => {
    const { client, update } = updateClient({ data: [{ id: true }], error: null });
    await setSmsNotificationsEnabled(client, true, 'admin-1');
    const patch = update.mock.calls[0][0];
    expect(patch.sms_notifications_enabled).toBe(true);
    expect(patch.updated_by).toBe('admin-1');
    expect('email_notifications_enabled' in patch).toBe(false);
  });

  it('reports a permission failure when RLS filters the update out', async () => {
    const { client } = updateClient({ data: [], error: null });
    await expect(setSmsNotificationsEnabled(client, true, 'admin-1')).rejects.toThrow(
      'Setting was not updated — you do not have permission.'
    );
  });
});

describe('setEmailNotificationsEnabled', () => {
  it('still updates only the email column', async () => {
    const { client, update } = updateClient({ data: [{ id: true }], error: null });
    await setEmailNotificationsEnabled(client, false, 'admin-1');
    const patch = update.mock.calls[0][0];
    expect(patch.email_notifications_enabled).toBe(false);
    expect('sms_notifications_enabled' in patch).toBe(false);
  });
});
