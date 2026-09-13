import { formatPHP } from './currency';

describe('formatPHP', () => {
  it('formats a whole number as PHP currency', () => {
    expect(formatPHP(12345.67)).toBe('₱12,345.67');
  });

  it('formats zero correctly', () => {
    expect(formatPHP(0)).toBe('₱0.00');
  });

  it('formats negative values with a leading minus before the symbol', () => {
    expect(formatPHP(-50)).toBe('-₱50.00');
  });
});
