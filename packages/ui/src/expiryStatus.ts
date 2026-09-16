export type ExpiryBadgeStatus = 'expired' | 'warning' | 'good' | 'unknown';

/**
 * `warningThresholdDays` is the household/item's configured notify-days
 * threshold (see `resolveNotifyThreshold` in `@pantry/core`) — this keeps
 * the pantry screen's badge colors in sync with the actual notification
 * eligibility window instead of a separate, hardcoded band.
 */
export function getExpiryBadgeStatus(
  daysUntilExpiry: number | null,
  warningThresholdDays: number
): ExpiryBadgeStatus {
  if (daysUntilExpiry === null) return 'unknown';
  // "On or after the expiration date" — day 0 (expires today) counts as
  // expired, not merely a warning.
  if (daysUntilExpiry <= 0) return 'expired';
  if (daysUntilExpiry <= warningThresholdDays) return 'warning';
  return 'good';
}
