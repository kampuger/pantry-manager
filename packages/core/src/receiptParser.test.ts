import { parseReceiptText } from './receiptParser';

describe('parseReceiptText', () => {
  it('extracts name and price from a clean multi-line receipt', () => {
    const text = 'MILK 2%\n4.99\nEGGS LARGE 12CT 3.49\nBREAD WHOLE WHEAT 2.99';
    // Note: the first two lines simulate a wrapped OCR line (name and price
    // split across lines) — this simple parser does NOT stitch those back
    // together, it only extracts price-terminated lines. "MILK 2%" has no
    // trailing price, so it's skipped; "4.99" alone has no name, so it's
    // also skipped. This is expected behavior for a first version.
    expect(parseReceiptText(text)).toEqual([
      { name: 'EGGS LARGE 12CT', price: 3.49 },
      { name: 'BREAD WHOLE WHEAT', price: 2.99 },
    ]);
  });

  it('strips dotted fill characters between name and price', () => {
    expect(parseReceiptText('MILK ..............4.99')).toEqual([{ name: 'MILK', price: 4.99 }]);
    expect(parseReceiptText('BREAD -------- 2.99')).toEqual([{ name: 'BREAD', price: 2.99 }]);
  });

  it('accepts a currency symbol before the price', () => {
    expect(parseReceiptText('MILK $4.99')).toEqual([{ name: 'MILK', price: 4.99 }]);
    expect(parseReceiptText('RICE ₱95.00')).toEqual([{ name: 'RICE', price: 95.0 }]);
  });

  it('accepts a comma as the decimal separator', () => {
    expect(parseReceiptText('MILK 4,99')).toEqual([{ name: 'MILK', price: 4.99 }]);
  });

  it('skips lines with no trailing price', () => {
    expect(parseReceiptText('THANK YOU FOR SHOPPING')).toEqual([]);
  });

  it('skips lines whose name is empty after stripping fill characters', () => {
    expect(parseReceiptText('.......... 4.99')).toEqual([]);
  });

  it.each(['TOTAL 45.99', 'SUBTOTAL 42.00', 'TAX 3.99', 'CASH 50.00', 'CHANGE 4.01', 'BALANCE 0.00', 'CARD 45.99', 'VISA 45.99', 'MASTERCARD 45.99', 'AMOUNT DUE 45.99'])(
    'skips denylisted line: %s',
    (line) => {
      expect(parseReceiptText(line)).toEqual([]);
    }
  );

  it('is case-insensitive when matching denylisted keywords', () => {
    expect(parseReceiptText('Total 45.99')).toEqual([]);
    expect(parseReceiptText('total 45.99')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseReceiptText('')).toEqual([]);
  });

  it('handles a thousands separator in the price', () => {
    expect(parseReceiptText('RICE 1,234.56')).toEqual([{ name: 'RICE', price: 1234.56 }]);
  });

  it('handles a trailing tax-flag letter after the price', () => {
    expect(parseReceiptText('MILK 4.99 T')).toEqual([{ name: 'MILK', price: 4.99 }]);
    expect(parseReceiptText('MILK 4.99T')).toEqual([{ name: 'MILK', price: 4.99 }]);
  });

  it('uses the trailing price when a line has two price-like numbers', () => {
    expect(parseReceiptText('MILK 2 @ 2.50 5.00')).toEqual([{ name: 'MILK 2 @ 2.50', price: 5.0 }]);
  });
});
