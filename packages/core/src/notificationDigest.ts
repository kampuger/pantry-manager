export interface DigestItem {
  name: string;
  daysUntilExpiry: number;
}

export interface DigestInput {
  householdName: string;
  introText: string | null;
  items: DigestItem[];
}

export interface DigestEmail {
  subject: string;
  body: string;
}

// The from-address has no real inbox behind it (see RESEND_FROM_ADDRESS) —
// this line is mandatory on every digest so recipients don't reply expecting
// a response.
const NO_REPLY_NOTICE = 'This is an automated message — replies to this email are not monitored.';

function describeDays(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    return `expired ${abs} day${abs === 1 ? '' : 's'} ago`;
  }
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

export interface DigestSendResult {
  ok: boolean;
  error?: string;
}

// A household's digest counts as sent for the day once at least one recipient
// actually got it: retrying after a partial failure would email the ones who
// already received it again, but marking a total failure as sent would silence
// the household until tomorrow.
export function shouldMarkDigestSent(results: DigestSendResult[]): boolean {
  return results.some((result) => result.ok);
}

export function buildDigestEmail(input: DigestInput): DigestEmail {
  const sorted = [...input.items].sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  const count = sorted.length;
  const subject = `${count} item${count === 1 ? '' : 's'} expiring soon in ${input.householdName}`;

  const itemLines = sorted.map((item) => `- ${item.name} — ${describeDays(item.daysUntilExpiry)}`).join('\n');
  const intro = input.introText?.trim();

  const body = [intro, itemLines, NO_REPLY_NOTICE].filter(Boolean).join('\n\n');

  return { subject, body };
}
