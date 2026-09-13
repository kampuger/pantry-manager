import { parseIngredientLine } from './ingredientParser';

describe('parseIngredientLine', () => {
  it('parses a whole-number quantity with a known unit', () => {
    expect(parseIngredientLine('2 tbsp butter')).toEqual({
      quantity: 2,
      unit: 'tbsp',
      name: 'butter',
    });
  });

  it('parses a fractional quantity and normalizes a unit alias', () => {
    expect(parseIngredientLine('1/2 cup flour')).toEqual({
      quantity: 0.5,
      unit: 'cups',
      name: 'flour',
    });
  });

  it('parses discrete piece counts', () => {
    expect(parseIngredientLine('3 pcs onion')).toEqual({
      quantity: 3,
      unit: 'pcs',
      name: 'onion',
    });
  });

  it('returns null quantity/unit for lines with no leading number', () => {
    expect(parseIngredientLine('salt to taste')).toEqual({
      quantity: null,
      unit: null,
      name: 'salt to taste',
    });
  });

  it('folds an unrecognized token after the number into the name', () => {
    expect(parseIngredientLine('5 large eggs')).toEqual({
      quantity: 5,
      unit: null,
      name: 'large eggs',
    });
  });
});
