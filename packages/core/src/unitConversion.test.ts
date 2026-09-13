import { toCanonical, compareAvailability } from './unitConversion';

describe('toCanonical', () => {
  it('converts weight units to grams', () => {
    expect(toCanonical(2, 'kg')).toEqual({ value: 2000, dimension: 'WEIGHT' });
    expect(toCanonical(1, 'lbs')).toEqual({ value: 453.592, dimension: 'WEIGHT' });
  });

  it('converts volume units to milliliters', () => {
    expect(toCanonical(2, 'tbsp')).toEqual({ value: 29.5736, dimension: 'VOLUME' });
  });

  it('leaves discrete units unconverted', () => {
    expect(toCanonical(3, 'pcs')).toEqual({ value: 3, dimension: 'DISCRETE' });
  });
});

describe('compareAvailability', () => {
  it('returns FULLY_AVAILABLE when stock covers the requirement in the same dimension', () => {
    expect(compareAvailability(500, 'g', 1, 'kg', 'flour')).toBe('FULLY_AVAILABLE');
  });

  it('returns PARTIALLY_AVAILABLE when stock is nonzero but insufficient', () => {
    expect(compareAvailability(2, 'kg', 500, 'g', 'flour')).toBe('PARTIALLY_AVAILABLE');
  });

  it('returns MISSING when stock is zero', () => {
    expect(compareAvailability(1, 'kg', 0, 'g', 'flour')).toBe('MISSING');
  });

  it('bridges volume to weight using a known ingredient density', () => {
    // 2 tbsp butter (~29.57 ml * 0.911 g/ml =~ 26.94 g) vs 1 lb (453.592 g) in stock
    expect(compareAvailability(2, 'tbsp', 1, 'lbs', 'butter')).toBe('FULLY_AVAILABLE');
  });

  it('returns MISSING when dimensions differ and no density is known', () => {
    expect(compareAvailability(2, 'tbsp', 1, 'lbs', 'unobtainium')).toBe('MISSING');
  });
});
