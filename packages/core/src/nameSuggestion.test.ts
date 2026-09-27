import { suggestKnownName } from './nameSuggestion';

describe('suggestKnownName', () => {
  it('suggests a known name that is a close match', () => {
    expect(suggestKnownName('Spicy Fearles', ['Spicy Fearless', 'Clam Chowder'])).toEqual({
      name: 'Spicy Fearless',
      similarity: expect.any(Number),
    });
  });

  it('returns null when nothing is close enough', () => {
    expect(suggestKnownName('Spicy Fearles', ['Clam Chowder', 'Bottled Water'])).toBeNull();
  });

  it('returns null for an exact match (nothing to suggest)', () => {
    expect(suggestKnownName('Clam Chowder', ['Clam Chowder'])).toBeNull();
  });

  it('is case- and whitespace-insensitive when comparing', () => {
    const result = suggestKnownName('clam  chowder', ['Clam Chowder']);
    expect(result).toBeNull(); // normalizes to the same string as an exact match
  });

  it('returns null for an empty candidate', () => {
    expect(suggestKnownName('', ['Clam Chowder'])).toBeNull();
  });

  it('returns null when there are no known names', () => {
    expect(suggestKnownName('Clam Chowder', [])).toBeNull();
  });

  it('picks the closest match when multiple known names are similar', () => {
    const result = suggestKnownName('Curly Frie', ['Curly Fries', 'Curly Fried Onions']);
    expect(result?.name).toBe('Curly Fries');
  });
});
