export interface ParsedReceiptLine {
  name: string;
  price: number;
}

// Group 1 captures the integer part, which may include thousands separators
// (comma, period, or space, in groups of exactly 3 digits) — the LAST `.`/`,`
// before group 2 is treated as the decimal point. An optional trailing
// single-letter tax flag (e.g. "4.99 T" or "4.99T") is allowed before the
// end of the line.
const PRICE_PATTERN = /(?:[$₱]\s*)?(\d{1,3}(?:[,.\s]\d{3})*|\d+)[.,](\d{2})\s*[A-Za-z]?\s*$/;

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

    // match[1] may contain thousands-separator characters (commas, periods,
    // or spaces) when the number had thousands grouping — strip them before
    // parsing so only the true decimal point (from match[2]) remains.
    const integerPart = match[1].replace(/[,.\s]/g, '');
    const price = Number(`${integerPart}.${match[2]}`);
    results.push({ name, price });
  }

  return results;
}
