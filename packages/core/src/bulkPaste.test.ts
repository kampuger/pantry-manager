import { parseBulkPasteGrid } from './bulkPaste';

describe('parseBulkPasteGrid', () => {
  it('returns an empty grid for empty input', () => {
    expect(parseBulkPasteGrid('')).toEqual([]);
  });

  it('parses a single pasted value as a 1x1 grid', () => {
    expect(parseBulkPasteGrid('Milk')).toEqual([['Milk']]);
  });

  it('splits newline-separated values into one row per line', () => {
    expect(parseBulkPasteGrid('Milk\nEggs\nBread')).toEqual([['Milk'], ['Eggs'], ['Bread']]);
  });

  it('splits tab-delimited lines into columns', () => {
    expect(parseBulkPasteGrid('Milk\t2\tpcs\nEggs\t12\tpcs')).toEqual([
      ['Milk', '2', 'pcs'],
      ['Eggs', '12', 'pcs'],
    ]);
  });

  it('falls back to comma-delimited columns when no line has a tab', () => {
    expect(parseBulkPasteGrid('Milk,2,pcs\nEggs,12,pcs')).toEqual([
      ['Milk', '2', 'pcs'],
      ['Eggs', '12', 'pcs'],
    ]);
  });

  it('does not comma-split a single line containing a comma (e.g. a product name)', () => {
    expect(parseBulkPasteGrid("Hershey's Cocoa, Unsweetened")).toEqual([["Hershey's Cocoa, Unsweetened"]]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseBulkPasteGrid('Milk\r\nEggs')).toEqual([['Milk'], ['Eggs']]);
  });

  it('drops a single trailing blank line but keeps interior blank lines', () => {
    expect(parseBulkPasteGrid('Milk\nEggs\n')).toEqual([['Milk'], ['Eggs']]);
    expect(parseBulkPasteGrid('Milk\n\nEggs')).toEqual([['Milk'], [''], ['Eggs']]);
  });

  it('trims whitespace around each cell', () => {
    expect(parseBulkPasteGrid('  Milk \t 2 \nEggs\t12')).toEqual([
      ['Milk', '2'],
      ['Eggs', '12'],
    ]);
  });
});
