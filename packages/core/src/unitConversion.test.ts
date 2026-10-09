import { toCanonical, compareAvailability, evaluateAvailability } from './unitConversion';

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

describe('evaluateAvailability', () => {
  it('returns a null shortfall when fully available', () => {
    expect(evaluateAvailability(500, 'g', 1, 'kg', 'flour')).toEqual({
      status: 'FULLY_AVAILABLE',
      shortfall: null,
    });
  });

  it('computes the shortfall in the stock unit when partially available in the same dimension', () => {
    expect(evaluateAvailability(2, 'kg', 500, 'g', 'flour')).toEqual({
      status: 'PARTIALLY_AVAILABLE',
      shortfall: { quantity: 1500, unit: 'g' },
    });
  });

  it('computes the full required amount as the shortfall when stock is zero', () => {
    expect(evaluateAvailability(1, 'kg', 0, 'g', 'flour')).toEqual({
      status: 'MISSING',
      shortfall: { quantity: 1000, unit: 'g' },
    });
  });

  it('bridges volume to weight via density when computing the shortfall (2 cups sugar vs 0.3kg in stock)', () => {
    const result = evaluateAvailability(2, 'cups', 0.3, 'kg', 'sugar');
    expect(result.status).toBe('PARTIALLY_AVAILABLE');
    expect(result.shortfall?.unit).toBe('kg');
    expect(result.shortfall?.quantity).toBeCloseTo(0.1, 2);
  });

  it('returns a null shortfall when dimensions differ and no density is known, rather than a fabricated number', () => {
    expect(evaluateAvailability(2, 'tbsp', 1, 'lbs', 'unobtainium')).toEqual({
      status: 'MISSING',
      shortfall: null,
    });
  });
});
