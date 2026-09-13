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

    expect(result).toMatchObject({ name: 'rice', quantity: 1, unit: 'kg', status: 'FULLY_AVAILABLE' });
    expect(result.matchedStock).toEqual({ name: 'rice', quantity: 2, unit: 'kg' });
  });

  it('marks PARTIALLY_AVAILABLE when stock is nonzero but insufficient', () => {
    const stock = [{ name: 'rice', quantity: 0.5, unit: 'kg' }];
    const [result] = matchRecipeIngredients('1 kg rice', stock);

    expect(result.status).toBe('PARTIALLY_AVAILABLE');
  });

  it('marks MISSING when no pantry item matches the ingredient name', () => {
    const stock = [{ name: 'rice', quantity: 2, unit: 'kg' }];
    const [result] = matchRecipeIngredients('2 pcs mango', stock);

    expect(result.status).toBe('MISSING');
    expect(result.matchedStock).toBeUndefined();
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

    expect(result).toMatchObject({ quantity: null, unit: null, status: 'FULLY_AVAILABLE' });
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
