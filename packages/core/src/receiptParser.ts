export interface ParsedReceiptLine {
  name: string;
  price: number;
  /** Only set when the source was a two-line "Qty Code Price Amount" row (see DATA_LINE_PATTERN) — single-line receipts never carry a quantity. */
  quantity?: number;
}

// Group 1 captures the integer part, which may include thousands separators
// (comma or period, in groups of exactly 3 digits) — the LAST `.`/`,` before
// group 2 is treated as the decimal point. Deliberately NOT including bare
// whitespace as a thousands separator (unlike a comma/period): a receipt
// line with two independent space-separated numbers — e.g. a garbled data
// line missing its code column, "29.00 203.00" — would otherwise let this
// pattern fuse fragments of BOTH numbers into one fake value (found via a
// live test: "I 29.00 203.00" parsed as a single ~200203 price). An
// optional trailing alphabetic tax-status code (e.g. "4.99 T" or "4.99TFA"
// — real receipts use anywhere from one to a few letters) is allowed before
// the end of the line.
const PRICE_PATTERN = /(?:[$₱]\s*)?(\d{1,3}(?:[,.]\d{3})*|\d+)[.,](\d{2})\s*[A-Za-z]*\s*$/;

// Matches a tabular "Qty  Code  UnitPrice  Amount" line — some POS receipts
// (found via a live test — a Philippine supermarket receipt) print the
// product NAME on its own line, then quantity/barcode/unit-price/line-total
// on the next. Group 1 is the quantity; groups 2/3 are the AMOUNT (the last
// column, qty × unit price) — the leading UnitPrice column is matched but
// not captured. This app's purchasePrice field represents the total paid
// for a pantry row, not a per-unit rate (confirmed against how the
// dashboard sums it: `items.reduce((sum, item) => sum + item.purchase_price)`,
// no multiplication by quantity), so Amount is the correct value to store,
// not UnitPrice — using UnitPrice would understate total spend by a factor
// of quantity for any multi-unit line.
// The gap between qty and the code tolerates OCR noise beyond plain
// whitespace — a real scan produced both a stray quote right after the qty
// digit ('4" 4800163001045 ...') and a missing space entirely, merged with
// an underscore ('4_A800024575250 ...').
const DATA_LINE_PATTERN = /^(\d+)[\s_'"]*\S+\s+(?:\d{1,3}(?:[,.]\d{3})*|\d+)[.,]\d{2}\s+(\d{1,3}(?:[,.]\d{3})*|\d+)[.,](\d{2})\s*$/;

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
  'tend',
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

function stripSeparators(digits: string): string {
  return digits.replace(/[,.]/g, '');
}

export function parseReceiptText(rawText: string): ParsedReceiptLine[] {
  const lines = rawText.split('\n').map((line) => line.trim());
  const results: ParsedReceiptLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (containsDenylistedKeyword(line)) continue;

    // Case A: name and price on the same line (e.g. "MILK 4.99").
    const sameLineMatch = line.match(PRICE_PATTERN);
    if (sameLineMatch) {
      const name = stripFillCharacters(line.slice(0, sameLineMatch.index));
      if (name === '') continue;
      const integerPart = stripSeparators(sameLineMatch[1]);
      const price = Number(`${integerPart}.${sameLineMatch[2]}`);
      results.push({ name, price });
      continue;
    }

    // Case B: the name is on its own line, and the very next line carries
    // "Qty Code UnitPrice Amount". Stitch the two together and consume both.
    if (line === '') continue;
    const nextLine = lines[i + 1];
    if (nextLine === undefined) continue;

    const dataMatch = nextLine.match(DATA_LINE_PATTERN);
    if (!dataMatch) continue;

    const name = stripFillCharacters(line);
    if (name === '') continue;

    const quantity = Number(dataMatch[1]);
    const integerPart = stripSeparators(dataMatch[2]);
    const price = Number(`${integerPart}.${dataMatch[3]}`);
    results.push({ name, price, quantity });
    i++; // consume the data line so it isn't also evaluated as its own candidate
  }

  return results;
}
