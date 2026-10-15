// Self-contained (no relative imports) so the Edge Functions can import it
// directly. `fetch` is injected so jest can test it without a network.

export type SmsSendResult = { ok: true; id?: string } | { ok: false; error: string };

export interface SmsSendInput {
  to: string;
  text: string;
}

export interface SmsProvider {
  send(input: SmsSendInput): Promise<SmsSendResult>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<FetchResponseLike>;

export interface SmsProviderEnv {
  SMS_PROVIDER?: string;
  TEXTBEE_API_KEY?: string;
}

// Same rule as isPhMobileE164 in phoneNumber.ts. Duplicated on purpose so this
// module stays import-free; smsProvider.test.ts pins the two together. The
// provider is the last gate before a real SMS leaves the building, so it
// refuses non-Philippine recipients itself instead of trusting its callers.
const PH_MOBILE_E164 = /^\+639\d{9}$/;

function extractMessageId(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    const candidate = parsed?.data?._id ?? parsed?.data?.id ?? parsed?._id ?? parsed?.id;
    return typeof candidate === 'string' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function createTextBeeProvider(options: {
  apiKey: string;
  fetchImpl: FetchLike;
  baseUrl?: string;
}): SmsProvider {
  const baseUrl = options.baseUrl ?? 'https://api.textbee.dev';
  return {
    async send({ to, text }) {
      if (!PH_MOBILE_E164.test(to)) {
        return { ok: false, error: 'Refusing to send: recipient is not a Philippine mobile number.' };
      }
      try {
        const response = await options.fetchImpl(`${baseUrl}/api/v1/gateway/send-sms`, {
          method: 'POST',
          headers: { 'x-api-key': options.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipients: [to], message: text }),
        });
        const raw = await response.text();
        if (!response.ok) {
          return { ok: false, error: `TextBee ${response.status}: ${raw.slice(0, 200)}` };
        }
        return { ok: true, id: extractMessageId(raw) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function createSmsProvider(env: SmsProviderEnv, fetchImpl: FetchLike): SmsProvider {
  const name = (env.SMS_PROVIDER ?? 'textbee').trim().toLowerCase();
  if (name === 'textbee') {
    if (!env.TEXTBEE_API_KEY) throw new Error('TEXTBEE_API_KEY is not set');
    return createTextBeeProvider({ apiKey: env.TEXTBEE_API_KEY, fetchImpl });
  }
  throw new Error(`Unknown SMS_PROVIDER: ${name}`);
}
