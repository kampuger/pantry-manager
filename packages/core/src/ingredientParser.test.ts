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

  it('treats common container words as discrete pcs units', () => {
    expect(parseIngredientLine('2 cans tomato sauce')).toEqual({
      quantity: 2,
      unit: 'pcs',
      name: 'tomato sauce',
    });
    expect(parseIngredientLine('1 jar peanut butter')).toEqual({
      quantity: 1,
      unit: 'pcs',
      name: 'peanut butter',
    });
    expect(parseIngredientLine('3 bottles soy sauce')).toEqual({
      quantity: 3,
      unit: 'pcs',
      name: 'soy sauce',
    });
  });

  it('still folds a non-standard unit like "pitcher" into the name, since it has no fixed size', () => {
    expect(parseIngredientLine('3 pitcher tomato sauce')).toEqual({
      quantity: 3,
      unit: null,
      name: 'pitcher tomato sauce',
    });
  });
});
