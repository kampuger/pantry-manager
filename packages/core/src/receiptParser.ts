export interface ParsedReceiptLine {
  name: string;
  price: number;
}

const PRICE_PATTERN = /(?:[$₱]\s*)?(\d+)[.,](\d{2})\s*$/;

const DENYLIST_KEYWORDS = [
  'total',
  'subtotal',
  'tax',
  'cash',
  'change',
  'balance',
  'card',
  'visa',
  'mastercard',
  'amount due',
];

function containsDenylistedKeyword(line: string): boolean {
  const lower = line.toLowerCase();
  return DENYLIST_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// Strips receipt-style fill characters (repeated dots, dashes, spaces) that
// commonly separate a name from its price, e.g. "MILK ..............4.99".
function stripFillCharacters(name: string): string {
  return name.replace(/[\s.\-]+$/, '').trim();
}

export function parseReceiptText(rawText: string): ParsedReceiptLine[] {
  const lines = rawText.split('\n');
  const results: ParsedReceiptLine[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (containsDenylistedKeyword(line)) continue;

    const match = line.match(PRICE_PATTERN);
    if (!match) continue;

    const name = stripFillCharacters(line.slice(0, match.index));
    if (name === '') continue;

    const price = Number(`${match[1]}.${match[2]}`);
    results.push({ name, price });
  }

  return results;
}
