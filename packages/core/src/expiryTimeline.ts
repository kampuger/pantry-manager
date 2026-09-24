const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type TimelineGranularity = 'daily' | 'weekly' | 'monthly';
export type TimelineCategory = 'expiring' | 'expired' | 'consumed';

export interface TimelineBucket {
  label: string;
  /** Signed distance from today in the given granularity's units — negative is past, 0 is today/this period, positive is future. */
  offset: number;
  counts: Record<TimelineCategory, number>;
}

export interface BuildTimelineBucketsInput {
  granularity: TimelineGranularity;
  /** Bare ISO `YYYY-MM-DD`, UTC-midnight convention (matches `daysUntil()` in @pantry/ui). */
  todayIso: string;
  pastBucketCount: number;
  futureBucketCount: number;
  /** Bare ISO `YYYY-MM-DD` dates per category to bucket — which categories can land in past vs. future buckets is entirely up to what dates the caller passes in, not enforced here. */
  dates: Partial<Record<TimelineCategory, string[]>>;
}

const CATEGORIES: TimelineCategory[] = ['expiring', 'expired', 'consumed'];

function parseUtcMidnight(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function dayOffset(dateIso: string, todayMs: number): number {
  return Math.round((parseUtcMidnight(dateIso) - todayMs) / MS_PER_DAY);
}

function monthOffset(dateIso: string, todayDate: Date): number {
  const d = new Date(parseUtcMidnight(dateIso));
  return d.getUTCFullYear() * 12 + d.getUTCMonth() - (todayDate.getUTCFullYear() * 12 + todayDate.getUTCMonth());
}

function bucketOffsetFor(dateIso: string, granularity: TimelineGranularity, todayMs: number, todayDate: Date): number {
  if (granularity === 'monthly') return monthOffset(dateIso, todayDate);
  const days = dayOffset(dateIso, todayMs);
  return granularity === 'weekly' ? Math.floor(days / 7) : days;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function dailyLabel(offset: number, todayDate: Date): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  if (offset === -1) return 'Yesterday';
  return shortDate(new Date(todayDate.getTime() + offset * MS_PER_DAY));
}

function weeklyLabel(offset: number, todayDate: Date): string {
  if (offset === 0) return 'This week';
  if (offset === -1) return 'Last week';
  return `Wk of ${shortDate(new Date(todayDate.getTime() + offset * 7 * MS_PER_DAY))}`;
}

function monthlyLabel(offset: number, todayDate: Date): string {
  const monthDate = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + offset, 1));
  const label = monthDate.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return monthDate.getUTCFullYear() === todayDate.getUTCFullYear()
    ? label
    : `${label} '${String(monthDate.getUTCFullYear()).slice(2)}`;
}

function labelFor(offset: number, granularity: TimelineGranularity, todayDate: Date): string {
  if (granularity === 'daily') return dailyLabel(offset, todayDate);
  if (granularity === 'weekly') return weeklyLabel(offset, todayDate);
  return monthlyLabel(offset, todayDate);
}

// Builds a single past-through-future bucket timeline shared by every
// category (expiring/expired/consumed) so they can be rendered as grouped
// bars per bucket on one chart. Which categories actually populate past vs.
// future buckets is a property of the dates the caller supplies, not
// something this function enforces — see BuildTimelineBucketsInput.
export function buildTimelineBuckets(input: BuildTimelineBucketsInput): TimelineBucket[] {
  const { granularity, todayIso, pastBucketCount, futureBucketCount, dates } = input;
  const todayMs = parseUtcMidnight(todayIso);
  const todayDate = new Date(todayMs);

  const buckets: TimelineBucket[] = [];
  for (let offset = -pastBucketCount; offset <= futureBucketCount; offset++) {
    buckets.push({
      label: labelFor(offset, granularity, todayDate),
      offset,
      counts: { expiring: 0, expired: 0, consumed: 0 },
    });
  }
  const indexByOffset = new Map(buckets.map((bucket, index) => [bucket.offset, index]));

  for (const category of CATEGORIES) {
    for (const dateIso of dates[category] ?? []) {
      const offset = bucketOffsetFor(dateIso, granularity, todayMs, todayDate);
      const index = indexByOffset.get(offset);
      if (index !== undefined) buckets[index].counts[category]++;
    }
  }

  return buckets;
}
