import { getPantryItemReminders, summarizeReminderRun, triggerRemindersNow } from './reminders';
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

describe('triggerRemindersNow with a non-2xx response', () => {
  it('returns the body when the function reported a status (e.g. email failed but SMS ran)', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: { json: async () => ({ status: 'send_failed', sms: { status: 'sent' } }) },
    });
    const invoke = jest.fn(async () => ({ data: null, error }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    expect(await triggerRemindersNow(client, 'house-1')).toEqual({ status: 'send_failed', sms: { status: 'sent' } });
  });

  it('still throws when the body is not a function result (e.g. a 403 plain-text body)', async () => {
    const error = Object.assign(new Error('403 Forbidden'), {
      context: {
        json: async () => {
          throw new Error('not json');
        },
      },
    });
    const invoke = jest.fn(async () => ({ data: null, error }));
    const client = { functions: { invoke } } as unknown as SupabaseClient<Database>;

    await expect(triggerRemindersNow(client, 'house-1')).rejects.toThrow('403 Forbidden');
  });
});

describe('summarizeReminderRun', () => {
  it('reports email and text outcomes separately', () => {
    expect(summarizeReminderRun({ status: 'sent', sms: { status: 'sent' } })).toBe('Email sent. Text messages sent.');
  });

  it('does not say nothing was sent when only the texts went out', () => {
    expect(summarizeReminderRun({ status: 'already_sent_today', sms: { status: 'sent' } })).toBe(
      'Email was already sent today. Text messages sent.'
    );
  });

  it('flags a failed channel without hiding the other', () => {
    expect(summarizeReminderRun({ status: 'send_failed', sms: { status: 'sent' } })).toBe(
      'Email failed to send. Text messages sent.'
    );
    expect(summarizeReminderRun({ status: 'sent', sms: { status: 'send_failed' } })).toBe(
      'Email sent. Some text messages failed — try again.'
    );
  });

  it('keeps the plain message when texting is off', () => {
    expect(summarizeReminderRun({ status: 'sent', sms: { status: 'household_disabled' } })).toBe('Email sent.');
    expect(summarizeReminderRun({ status: 'sent' })).toBe('Email sent.');
  });

  it('says so when there is nothing to send at all', () => {
    expect(summarizeReminderRun({ status: 'no_eligible_items', sms: undefined })).toBe(
      'Nothing to send — no items are expiring soon.'
    );
  });

  it('explains an unconfigured gateway', () => {
    expect(summarizeReminderRun({ status: 'sent', sms: { status: 'sms_not_configured' } })).toBe(
      'Email sent. The SMS gateway is not configured.'
    );
  });
});
