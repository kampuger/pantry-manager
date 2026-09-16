import { getExpiryBadgeStatus } from './expiryStatus';

describe('getExpiryBadgeStatus', () => {
  it('returns "expired" for items expiring today or already past their date', () => {
    expect(getExpiryBadgeStatus(0, 2)).toBe('expired');
    expect(getExpiryBadgeStatus(-1, 2)).toBe('expired');
    expect(getExpiryBadgeStatus(-30, 2)).toBe('expired');
  });

  it('returns "warning" for items within the given threshold', () => {
    expect(getExpiryBadgeStatus(1, 2)).toBe('warning');
    expect(getExpiryBadgeStatus(2, 2)).toBe('warning');
    expect(getExpiryBadgeStatus(7, 7)).toBe('warning');
  });

  it('returns "good" for items beyond the given threshold', () => {
    expect(getExpiryBadgeStatus(3, 2)).toBe('good');
    expect(getExpiryBadgeStatus(8, 7)).toBe('good');
    expect(getExpiryBadgeStatus(365, 2)).toBe('good');
  });

  it('honors different thresholds for the same days-until-expiry value', () => {
    // 5 days out is a warning under a 7-day (non-produce) threshold...
    expect(getExpiryBadgeStatus(5, 7)).toBe('warning');
    // ...but still "good" under a 2-day (produce) threshold.
    expect(getExpiryBadgeStatus(5, 2)).toBe('good');
  });

  it('returns "unknown" when no expiration date is set, regardless of threshold', () => {
    expect(getExpiryBadgeStatus(null, 2)).toBe('unknown');
    expect(getExpiryBadgeStatus(null, 7)).toBe('unknown');
  });
});
