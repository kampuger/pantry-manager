import { getExpiryBadgeStatus } from './expiryStatus';

describe('getExpiryBadgeStatus', () => {
  it('returns "critical" for items expiring within 2 days', () => {
    expect(getExpiryBadgeStatus(2)).toBe('critical');
    expect(getExpiryBadgeStatus(0)).toBe('critical');
    expect(getExpiryBadgeStatus(-1)).toBe('critical'); // already expired
  });

  it('returns "warning" for items expiring within 3-7 days', () => {
    expect(getExpiryBadgeStatus(3)).toBe('warning');
    expect(getExpiryBadgeStatus(7)).toBe('warning');
  });

  it('returns "ok" for items expiring in more than 7 days', () => {
    expect(getExpiryBadgeStatus(8)).toBe('ok');
    expect(getExpiryBadgeStatus(365)).toBe('ok');
  });

  it('returns "unknown" when no expiration date is set', () => {
    expect(getExpiryBadgeStatus(null)).toBe('unknown');
  });
});
