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

function describeDays(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    return `expired ${abs} day${abs === 1 ? '' : 's'} ago`;
  }
  if (days === 0) return 'expires today';
  if (days === 1) return 'expires tomorrow';
  return `expires in ${days} days`;
}

export function buildDigestEmail(input: DigestInput): DigestEmail {
  const sorted = [...input.items].sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  const count = sorted.length;
  const subject = `${count} item${count === 1 ? '' : 's'} expiring soon in ${input.householdName}`;

  const itemLines = sorted.map((item) => `- ${item.name} — ${describeDays(item.daysUntilExpiry)}`).join('\n');
  const intro = input.introText?.trim();

  const body = intro ? `${intro}\n\n${itemLines}` : itemLines;

  return { subject, body };
}
