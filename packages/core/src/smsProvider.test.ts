import { createSmsProvider, createTextBeeProvider, type FetchLike } from './smsProvider';
import { isPhMobileE164 } from './phoneNumber';

function fakeFetch(response: { ok: boolean; status: number; body: string }) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok, status: response.status, text: async () => response.body };
  };
  return { fetchImpl, calls };
}

describe('createTextBeeProvider', () => {
  it('posts the recipient and message with the API key header', async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 201, body: JSON.stringify({ data: { _id: 'msg-1' } }) });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });

    const result = await provider.send({ to: '+639171234567', text: 'hello' });

    expect(result).toEqual({ ok: true, id: 'msg-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.textbee.dev/api/v1/gateway/send-sms');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers['x-api-key']).toBe('secret');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0].init.body)).toEqual({ recipients: ['+639171234567'], message: 'hello' });
  });

  it('succeeds without an id when the response body is not the expected shape', async () => {
    const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: 'not json' });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    expect(await provider.send({ to: '+639171234567', text: 'hi' })).toEqual({ ok: true, id: undefined });
  });

  it('reports HTTP errors with the status and a truncated body', async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 429, body: 'x'.repeat(500) });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    const result = await provider.send({ to: '+639171234567', text: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.startsWith('TextBee 429: ')).toBe(true);
      expect(result.error.length).toBeLessThanOrEqual('TextBee 429: '.length + 200);
    }
  });

  it('reports network failures instead of throwing', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('socket hang up');
    };
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    expect(await provider.send({ to: '+639171234567', text: 'hi' })).toEqual({ ok: false, error: 'socket hang up' });
  });

  it.each(['+12025550123', '09171234567', '+63281234567', '', '+6391712345678'])(
    'refuses %j without calling the gateway',
    async (to) => {
      const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: '{}' });
      const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
      const result = await provider.send({ to, text: 'hi' });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
    }
  );

  it('uses the same recipient rule as isPhMobileE164', async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: '{}' });
    const provider = createTextBeeProvider({ apiKey: 'secret', fetchImpl });
    for (const candidate of ['+639171234567', '+639999999999', '+6391712345', '+639abcdefghi', '639171234567']) {
      calls.length = 0;
      await provider.send({ to: candidate, text: 'hi' });
      expect(calls.length === 1).toBe(isPhMobileE164(candidate));
    }
  });
});

describe('createSmsProvider', () => {
  const { fetchImpl } = fakeFetch({ ok: true, status: 200, body: '{}' });

  it('defaults to TextBee', () => {
    expect(() => createSmsProvider({ TEXTBEE_API_KEY: 'k' }, fetchImpl)).not.toThrow();
  });

  it('requires the TextBee API key', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'textbee' }, fetchImpl)).toThrow('TEXTBEE_API_KEY is not set');
  });

  it('rejects an unknown provider name', () => {
    expect(() => createSmsProvider({ SMS_PROVIDER: 'carrier-pigeon', TEXTBEE_API_KEY: 'k' }, fetchImpl)).toThrow(
      'Unknown SMS_PROVIDER: carrier-pigeon'
    );
  });
});
