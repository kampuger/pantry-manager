import { resolveCsvHeader } from './csvHeaders';

describe('resolveCsvHeader', () => {
  it('resolves the name column', () => {
    expect(resolveCsvHeader('Name')).toBe('name');
  });

  it('resolves quantity column aliases', () => {
    expect(resolveCsvHeader('Qty')).toBe('quantity');
    expect(resolveCsvHeader('Quantity')).toBe('quantity');
  });

  it('resolves the unit column', () => {
    expect(resolveCsvHeader('Unit')).toBe('unit');
  });

  it('resolves storage location column aliases', () => {
    expect(resolveCsvHeader('Location')).toBe('storageLocation');
    expect(resolveCsvHeader('Storage Location')).toBe('storageLocation');
  });

  it('resolves produce column aliases', () => {
    expect(resolveCsvHeader('Produce')).toBe('isProduce');
    expect(resolveCsvHeader('Is Produce')).toBe('isProduce');
    expect(resolveCsvHeader('Perishable')).toBe('isProduce');
  });

  it('resolves expiry column aliases', () => {
    expect(resolveCsvHeader('Expiry')).toBe('expirationDate');
    expect(resolveCsvHeader('Expiration')).toBe('expirationDate');
    expect(resolveCsvHeader('Expiration Date')).toBe('expirationDate');
  });

  it('resolves price column aliases', () => {
    expect(resolveCsvHeader('Price')).toBe('purchasePrice');
    expect(resolveCsvHeader('Purchase Price')).toBe('purchasePrice');
  });

  it('matches case-insensitively', () => {
    expect(resolveCsvHeader('NAME')).toBe('name');
    expect(resolveCsvHeader('qTy')).toBe('quantity');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveCsvHeader('  Name  ')).toBe('name');
  });

  it('returns null for an unrecognized header', () => {
    expect(resolveCsvHeader('Notes')).toBeNull();
    expect(resolveCsvHeader('SKU')).toBeNull();
    expect(resolveCsvHeader('')).toBeNull();
  });
});
