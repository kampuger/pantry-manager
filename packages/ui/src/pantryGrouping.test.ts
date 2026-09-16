import { groupItemsByLocation } from './pantryGrouping';

describe('groupItemsByLocation', () => {
  it('groups items by location in the given order, omitting empty locations', () => {
    const items = [
      { id: '1', storageLocation: 'PANTRY', daysUntilExpiry: 30, warningThresholdDays: 7 },
      { id: '2', storageLocation: 'FRIDGE', daysUntilExpiry: 1, warningThresholdDays: 2 },
      { id: '3', storageLocation: 'FRIDGE', daysUntilExpiry: 10, warningThresholdDays: 2 },
    ];
    const result = groupItemsByLocation(items, ['FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER']);
    expect(result).toEqual([
      { location: 'FRIDGE', itemIds: ['2', '3'], expiringSoonCount: 1, expiredCount: 0 },
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0, expiredCount: 0 },
    ]);
  });

  it('returns an empty array when there are no items', () => {
    expect(groupItemsByLocation([], ['FRIDGE', 'PANTRY'])).toEqual([]);
  });

  it('counts items with unknown expiry as neither expiring soon nor expired', () => {
    const items = [{ id: '1', storageLocation: 'PANTRY', daysUntilExpiry: null, warningThresholdDays: 7 }];
    expect(groupItemsByLocation(items, ['PANTRY'])).toEqual([
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0, expiredCount: 0 },
    ]);
  });

  it('counts already-expired items separately from expiring-soon items', () => {
    const items = [
      { id: '1', storageLocation: 'FRIDGE', daysUntilExpiry: -3, warningThresholdDays: 2 },
      { id: '2', storageLocation: 'FRIDGE', daysUntilExpiry: 1, warningThresholdDays: 2 },
    ];
    expect(groupItemsByLocation(items, ['FRIDGE'])).toEqual([
      { location: 'FRIDGE', itemIds: ['1', '2'], expiringSoonCount: 1, expiredCount: 1 },
    ]);
  });

  it("respects each item's own warning threshold, not a shared constant", () => {
    const items = [
      // 5 days out: a warning under a 7-day (non-produce) threshold...
      { id: '1', storageLocation: 'PANTRY', daysUntilExpiry: 5, warningThresholdDays: 7 },
      // ...but "good" (not counted) under a 2-day (produce) threshold.
      { id: '2', storageLocation: 'PANTRY', daysUntilExpiry: 5, warningThresholdDays: 2 },
    ];
    expect(groupItemsByLocation(items, ['PANTRY'])).toEqual([
      { location: 'PANTRY', itemIds: ['1', '2'], expiringSoonCount: 1, expiredCount: 0 },
    ]);
  });
});
