import { computeExpiryDate, resolveNotifyThreshold } from './expiry';

describe('computeExpiryDate', () => {
  it('computes produce expiry as 7 days after the purchase date', () => {
    expect(computeExpiryDate({ isProduce: true, purchaseDate: '2026-09-14' })).toBe('2026-09-21');
  });

  it('defaults the purchase date to today when producing and none is given', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-14T12:00:00Z'));
    try {
      expect(computeExpiryDate({ isProduce: true })).toBe('2026-09-21');
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the manual date for non-produce items', () => {
    expect(computeExpiryDate({ isProduce: false, manualDate: '2027-01-01' })).toBe('2027-01-01');
  });

  it('throws when non-produce and no manual date is given', () => {
    expect(() => computeExpiryDate({ isProduce: false })).toThrow(
      'manualDate is required for non-produce items'
    );
  });
});

describe('resolveNotifyThreshold', () => {
  const household = { notifyDaysProduce: 2, notifyDaysNonproduce: 7 };

  it('uses the household produce default when the item has no override', () => {
    expect(resolveNotifyThreshold({ isProduce: true, notifyDaysBeforeExpiry: null }, household)).toBe(2);
  });

  it('uses the household non-produce default when the item has no override', () => {
    expect(resolveNotifyThreshold({ isProduce: false, notifyDaysBeforeExpiry: null }, household)).toBe(7);
  });

  it('uses the per-item override when set, regardless of produce type', () => {
    expect(resolveNotifyThreshold({ isProduce: true, notifyDaysBeforeExpiry: 5 }, household)).toBe(5);
    expect(resolveNotifyThreshold({ isProduce: false, notifyDaysBeforeExpiry: 0 }, household)).toBe(0);
  });
});
