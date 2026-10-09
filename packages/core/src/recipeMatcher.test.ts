import { matchRecipeIngredients } from './recipeMatcher';

describe('matchRecipeIngredients', () => {
  it('splits multi-line recipe text into ingredient lines and skips blanks', () => {
    const text = '2 tbsp butter\n\n3 pcs onion\n   \n1 kg rice';
    const stock = [
      { name: 'butter', quantity: 1, unit: 'lbs' },
      { name: 'onion', quantity: 5, unit: 'pcs' },
      { name: 'rice', quantity: 2, unit: 'kg' },
    ];

    const result = matchRecipeIngredients(text, stock);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.rawLine)).toEqual(['2 tbsp butter', '3 pcs onion', '1 kg rice']);
  });

  it('marks FULLY_AVAILABLE when stock covers the required quantity', () => {
    const stock = [{ name: 'rice', quantity: 2, unit: 'kg' }];
    const [result] = matchRecipeIngredients('1 kg rice', stock);

    expect(result).toMatchObject({ name: 'rice', quantity: 1, unit: 'kg', status: 'FULLY_AVAILABLE', shortfall: null });
    expect(result.matchedStock).toEqual({ name: 'rice', quantity: 2, unit: 'kg' });
  });

  it('marks PARTIALLY_AVAILABLE when stock is nonzero but insufficient, and reports the shortfall', () => {
    const stock = [{ name: 'rice', quantity: 0.5, unit: 'kg' }];
    const [result] = matchRecipeIngredients('1 kg rice', stock);

    expect(result.status).toBe('PARTIALLY_AVAILABLE');
    expect(result.shortfall).toEqual({ quantity: 0.5, unit: 'kg' });
  });

  it('marks MISSING when no pantry item matches the ingredient name, with the shortfall as the full required amount', () => {
    const stock = [{ name: 'rice', quantity: 2, unit: 'kg' }];
    const [result] = matchRecipeIngredients('2 pcs mango', stock);

    expect(result.status).toBe('MISSING');
    expect(result.matchedStock).toBeUndefined();
    expect(result.shortfall).toEqual({ quantity: 2, unit: 'pcs' });
  });

  it('leaves the shortfall null when units cross dimensions with no known density, instead of a fabricated number', () => {
    const stock = [{ name: 'wood chips', quantity: 1, unit: 'lbs' }];
    const [result] = matchRecipeIngredients('2 tbsp wood chips', stock);

    expect(result.status).toBe('MISSING');
    expect(result.matchedStock).toBeDefined();
    expect(result.shortfall).toBeNull();
  });

  it('does not claim availability when a quantity was given but the unit word is unrecognized (e.g. "pitcher")', () => {
    const stock = [{ name: 'tomato sauce', quantity: 2, unit: 'pcs' }];
    const [result] = matchRecipeIngredients('3 pitcher tomato sauce', stock);

    expect(result.status).toBe('MISSING');
    expect(result.matchedStock).toBeDefined();
    expect(result.shortfall).toBeNull();
  });

  it('numerically compares container words like "cans" against pcs stock', () => {
    const stock = [{ name: 'tomato sauce', quantity: 2, unit: 'pcs' }];
    const [result] = matchRecipeIngredients('3 cans tomato sauce', stock);

    expect(result.status).toBe('PARTIALLY_AVAILABLE');
    expect(result.shortfall).toEqual({ quantity: 1, unit: 'pcs' });
  });

  it('matches names case-insensitively and via substring (simple pluralization)', () => {
    const stock = [{ name: 'Onions', quantity: 3, unit: 'pcs' }];
    const [result] = matchRecipeIngredients('1 pcs onion', stock);

    expect(result.status).toBe('FULLY_AVAILABLE');
    expect(result.matchedStock?.name).toBe('Onions');
  });

  it('treats a matched item with no parsed quantity/unit as available if in stock', () => {
    const stock = [{ name: 'salt', quantity: 1, unit: 'kg' }];
    const [result] = matchRecipeIngredients('salt to taste', stock);

    expect(result).toMatchObject({ quantity: null, unit: null, status: 'FULLY_AVAILABLE', shortfall: null });
  });

  it('treats a matched item with zero stock and no parsed quantity as MISSING', () => {
    const stock = [{ name: 'salt', quantity: 0, unit: 'kg' }];
    const [result] = matchRecipeIngredients('salt to taste', stock);

    expect(result.status).toBe('MISSING');
  });

  it('returns an empty array for blank input', () => {
    expect(matchRecipeIngredients('   \n\n  ', [])).toEqual([]);
  });
});
