import { buildTimelineBuckets } from './expiryTimeline';

describe('buildTimelineBuckets', () => {
  const TODAY = '2026-09-25'; // a Friday

  it('buckets daily offsets into Today/Tomorrow/Yesterday plus short dates further out', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'daily',
      todayIso: TODAY,
      pastBucketCount: 2,
      futureBucketCount: 2,
      dates: { expiring: ['2026-09-25', '2026-09-26', '2026-09-27'] },
    });

    expect(buckets.map((b) => b.label)).toEqual(['Sep 23', 'Yesterday', 'Today', 'Tomorrow', 'Sep 27']);
    expect(buckets.map((b) => b.offset)).toEqual([-2, -1, 0, 1, 2]);
    expect(buckets.map((b) => b.counts.expiring)).toEqual([0, 0, 1, 1, 1]);
  });

  it('drops dates outside the past/future window rather than clamping them into the edge bucket', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'daily',
      todayIso: TODAY,
      pastBucketCount: 1,
      futureBucketCount: 1,
      dates: { expiring: ['2026-09-30'], expired: ['2026-09-01'] },
    });

    expect(buckets.reduce((sum, b) => sum + b.counts.expiring + b.counts.expired, 0)).toBe(0);
  });

  it('buckets multiple categories independently within the same call', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'daily',
      todayIso: TODAY,
      pastBucketCount: 1,
      futureBucketCount: 1,
      dates: {
        expiring: ['2026-09-26', '2026-09-26'],
        expired: ['2026-09-24'],
        consumed: ['2026-09-24', '2026-09-25'],
      },
    });

    const today = buckets.find((b) => b.offset === 0)!;
    const yesterday = buckets.find((b) => b.offset === -1)!;
    const tomorrow = buckets.find((b) => b.offset === 1)!;

    expect(tomorrow.counts).toEqual({ expiring: 2, expired: 0, consumed: 0 });
    expect(yesterday.counts).toEqual({ expiring: 0, expired: 1, consumed: 1 });
    expect(today.counts).toEqual({ expiring: 0, expired: 0, consumed: 1 });
  });

  it('groups weekly offsets the same way for future and past dates (matches forward Math.floor behavior)', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'weekly',
      todayIso: TODAY,
      pastBucketCount: 2,
      futureBucketCount: 2,
      // +0d and +6d -> this week (offset 0); +7d -> next week (offset 1)
      // -1d and -7d -> last week (offset -1); -8d -> two weeks ago (offset -2)
      dates: { expiring: ['2026-09-25', '2026-10-01', '2026-10-02'], expired: ['2026-09-24', '2026-09-18', '2026-09-17'] },
    });

    expect(buckets.map((b) => b.label)).toEqual([
      'Wk of Sep 11',
      'Last week',
      'This week',
      'Wk of Oct 2',
      'Wk of Oct 9',
    ]);
    const thisWeek = buckets.find((b) => b.offset === 0)!;
    const nextWeek = buckets.find((b) => b.offset === 1)!;
    const lastWeek = buckets.find((b) => b.offset === -1)!;
    const twoWeeksAgo = buckets.find((b) => b.offset === -2)!;

    expect(thisWeek.counts.expiring).toBe(2); // Sep 25 and Oct 1 both fall in the 7-day window starting today
    expect(nextWeek.counts.expiring).toBe(1); // Oct 2
    expect(lastWeek.counts.expired).toBe(2); // Sep 24 and Sep 18
    expect(twoWeeksAgo.counts.expired).toBe(1); // Sep 17
  });

  it('groups monthly offsets by calendar month, including across a year boundary', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'monthly',
      todayIso: '2026-12-15',
      pastBucketCount: 1,
      futureBucketCount: 1,
      dates: { expiring: ['2027-01-05'], expired: ['2026-11-20'] },
    });

    // Today is Dec 2026: Nov 2026 is same year (no suffix), Jan 2027 crosses
    // into the next year (gets the suffix).
    expect(buckets.map((b) => b.label)).toEqual(['Nov', 'Dec', "Jan '27"]);
    const nextMonth = buckets.find((b) => b.offset === 1)!;
    const lastMonth = buckets.find((b) => b.offset === -1)!;
    expect(nextMonth.counts.expiring).toBe(1);
    expect(lastMonth.counts.expired).toBe(1);
  });

  it('returns all-zero counts for categories with no dates', () => {
    const buckets = buildTimelineBuckets({
      granularity: 'daily',
      todayIso: TODAY,
      pastBucketCount: 1,
      futureBucketCount: 1,
      dates: {},
    });

    for (const bucket of buckets) {
      expect(bucket.counts).toEqual({ expiring: 0, expired: 0, consumed: 0 });
    }
  });
});
