export type ExpiryBadgeStatus = 'critical' | 'warning' | 'ok' | 'unknown';

export function getExpiryBadgeStatus(daysUntilExpiry: number | null): ExpiryBadgeStatus {
  if (daysUntilExpiry === null) return 'unknown';
  if (daysUntilExpiry <= 2) return 'critical';
  if (daysUntilExpiry <= 7) return 'warning';
  return 'ok';
}
