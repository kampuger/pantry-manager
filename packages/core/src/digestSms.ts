// Self-contained (no relative imports) so the Edge Functions can import it
// directly. Output is restricted to characters in the GSM-7 basic set so a
// message stays a single 160-character segment; one character outside it
// (an emoji, a backtick) re-encodes the whole message as 70-character UCS-2.

export interface SmsDigestItem {
  name: string;
  daysUntilExpiry: number;
}

export interface SmsDigestInput {
  householdName: string;
  items: SmsDigestItem[];
}

const MAX_LENGTH = 160;
const MAX_HOUSEHOLD_NAME_LENGTH = 20;
const MAX_ITEM_NAME_LENGTH = 40;
const FOOTER = '. Open the app for details.';

function toGsmSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 @$!"#%&'()*+,\-./:;<=>?_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function describeDays(days: number): string {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export function buildDigestSms(input: SmsDigestInput): string {
  const household = toGsmSafe(input.householdName).slice(0, MAX_HOUSEHOLD_NAME_LENGTH).trim();
  const head = `Pantry (${household}): `;

  if (input.items.length === 0) {
    return `Pantry (${household}): nothing expiring soon.`;
  }

  const labels = [...input.items]
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
    .map((item) => `${toGsmSafe(item.name).slice(0, MAX_ITEM_NAME_LENGTH).trim()} ${describeDays(item.daysUntilExpiry)}`);

  let shown = 1;
  for (let count = 1; count <= labels.length; count += 1) {
    const remaining = labels.length - count;
    const candidate = head + labels.slice(0, count).join(', ') + (remaining > 0 ? ` +${remaining} more` : '') + FOOTER;
    if (candidate.length > MAX_LENGTH) break;
    shown = count;
  }

  const remaining = labels.length - shown;
  return head + labels.slice(0, shown).join(', ') + (remaining > 0 ? ` +${remaining} more` : '') + FOOTER;
}
