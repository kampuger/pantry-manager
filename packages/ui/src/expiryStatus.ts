export type ExpiryBadgeStatus = 'expired' | 'critical' | 'warning' | 'ok' | 'unknown';

export function getExpiryBadgeStatus(daysUntilExpiry: number | null): ExpiryBadgeStatus {
  if (daysUntilExpiry === null) return 'unknown';
  // Already past its expiration date — meaningfully different from "expires
  // tomorrow", so it gets its own bucket rather than sharing 'critical'.
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 2) return 'critical';
  if (daysUntilExpiry <= 7) return 'warning';
  return 'ok';
}
