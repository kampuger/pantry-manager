import { getFreshnessFlag, isFreshProduceCategory } from './freshness';

describe('fresh produce handling', () => {
  it('recognizes fresh produce categories', () => {
    expect(isFreshProduceCategory('meat')).toBe(true);
    expect(isFreshProduceCategory('vegetables')).toBe(true);
    expect(isFreshProduceCategory('rice')).toBe(false);
  });

  it('flags fresh produce older than seven days since restock', () => {
    const now = new Date('2026-09-13T12:00:00Z');

    expect(getFreshnessFlag('2026-09-05T00:00:00Z', 'meat', now)).toBe(true);
    expect(getFreshnessFlag('2026-09-10T00:00:00Z', 'vegetables', now)).toBe(false);
    expect(getFreshnessFlag('2026-09-12T00:00:00Z', 'rice', now)).toBe(false);
  });
});
