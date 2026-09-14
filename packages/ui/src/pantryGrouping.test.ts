import { groupItemsByLocation } from './pantryGrouping';

describe('groupItemsByLocation', () => {
  it('groups items by location in the given order, omitting empty locations', () => {
    const items = [
      { id: '1', storageLocation: 'PANTRY', daysUntilExpiry: 30 },
      { id: '2', storageLocation: 'FRIDGE', daysUntilExpiry: 1 },
      { id: '3', storageLocation: 'FRIDGE', daysUntilExpiry: 10 },
    ];
    const result = groupItemsByLocation(items, ['FRIDGE', 'FREEZER', 'PANTRY', 'COUNTER', 'OTHER']);
    expect(result).toEqual([
      { location: 'FRIDGE', itemIds: ['2', '3'], expiringSoonCount: 1 },
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0 },
    ]);
  });

  it('returns an empty array when there are no items', () => {
    expect(groupItemsByLocation([], ['FRIDGE', 'PANTRY'])).toEqual([]);
  });

  it('counts items with unknown expiry as not expiring soon', () => {
    const items = [{ id: '1', storageLocation: 'PANTRY', daysUntilExpiry: null }];
    expect(groupItemsByLocation(items, ['PANTRY'])).toEqual([
      { location: 'PANTRY', itemIds: ['1'], expiringSoonCount: 0 },
    ]);
  });
});
