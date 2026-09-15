import { daysUntil } from './daysUntil';

describe('daysUntil', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function at(instant: string) {
    jest.useFakeTimers().setSystemTime(new Date(instant));
  }

  it('returns null when no date is given', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('returns null for an unparseable date', () => {
    expect(daysUntil('not-a-date')).toBeNull();
  });

  it('returns a whole-day count that does not shift with the time of day', () => {
    // Same calendar day, three very different times — the old
    // `target - Date.now()` implementation returned 5, 4 and 4 here.
    at('2026-09-15T00:00:01Z');
    expect(daysUntil('2026-09-20')).toBe(5);

    at('2026-09-15T12:00:00Z');
    expect(daysUntil('2026-09-20')).toBe(5);

    at('2026-09-15T23:59:59Z');
    expect(daysUntil('2026-09-20')).toBe(5);
  });

  it('returns 0 for today and 1 for tomorrow', () => {
    at('2026-09-15T18:30:00Z');
    expect(daysUntil('2026-09-15')).toBe(0);
    expect(daysUntil('2026-09-16')).toBe(1);
  });

  it('returns a negative count for a date that has already passed', () => {
    at('2026-09-15T06:00:00Z');
    expect(daysUntil('2026-09-14')).toBe(-1);
    expect(daysUntil('2026-09-01')).toBe(-14);
  });

  it('counts across a month boundary', () => {
    at('2026-09-28T09:15:00Z');
    expect(daysUntil('2026-10-03')).toBe(5);
  });
});
