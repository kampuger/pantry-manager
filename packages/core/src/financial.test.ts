import {
  computeConsumedValue,
  computeWastedValue,
  computePantryEfficiency,
  computeCategorySpend,
  computeTripAverage,
  type MovementLogRecord,
} from './financial';

describe('financial formulas', () => {
  const logs: MovementLogRecord[] = [
    { eventType: 'CONSUMED', valueDelta: 100 },
    { eventType: 'CONSUMED', valueDelta: 50 },
    { eventType: 'EXPIRED', valueDelta: 30 },
    { eventType: 'SPOILED_DISCARDED', valueDelta: 20 },
    { eventType: 'PURCHASED', valueDelta: null },
  ];

  it('sums consumed value', () => {
    expect(computeConsumedValue(logs)).toBe(150);
  });

  it('sums wasted value across EXPIRED and SPOILED_DISCARDED', () => {
    expect(computeWastedValue(logs)).toBe(50);
  });

  it('computes pantry efficiency as a percentage', () => {
    expect(computePantryEfficiency(logs)).toBeCloseTo(75, 5); // 150 / 200 * 100
  });

  it('returns null efficiency when no value has moved', () => {
    expect(computePantryEfficiency([])).toBeNull();
  });

  it('groups category spend by categoryId', () => {
    const items = [
      { categoryId: 'meat', purchasePrice: 200 },
      { categoryId: 'meat', purchasePrice: 100 },
      { categoryId: 'dairy', purchasePrice: 50 },
    ];
    expect(computeCategorySpend(items)).toEqual({ meat: 300, dairy: 50 });
  });

  it('averages trip spend, or returns null for zero trips', () => {
    expect(computeTripAverage([{ totalSpent: 500 }, { totalSpent: 300 }])).toBe(400);
    expect(computeTripAverage([])).toBeNull();
  });
});
