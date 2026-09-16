import { formatExpiryDate } from './expiryDateFormat';

describe('formatExpiryDate', () => {
  it('formats a bare ISO date as a short human-readable date', () => {
    expect(formatExpiryDate('2026-09-23')).toBe('Sep 23, 2026');
  });

  it('formats single-digit days and different months correctly', () => {
    expect(formatExpiryDate('2026-01-05')).toBe('Jan 5, 2026');
  });

  it('returns an empty string for null', () => {
    expect(formatExpiryDate(null)).toBe('');
  });

  it('falls back to the raw string for an unparseable date', () => {
    expect(formatExpiryDate('not-a-date')).toBe('not-a-date');
  });

  it('is not affected by the time-of-day portion, if present', () => {
    expect(formatExpiryDate('2026-09-23T15:30:00Z')).toBe('Sep 23, 2026');
  });
});
