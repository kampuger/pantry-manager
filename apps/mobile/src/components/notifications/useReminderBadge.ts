import { useEffect, useState } from 'react';
import { getMemberNotificationsEnabled, getHouseholdNotificationPrefs } from '@pantry/supabase-client';
import { daysUntil, getExpiryBadgeStatus } from '@pantry/ui';
import { resolveNotifyThreshold } from '@pantry/core';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/AuthProvider';
import { useHousehold } from '../../lib/useHousehold';
import { onNotificationsChanged } from '../../lib/notificationEvents';

/** Badge count for the Pantry tab, or `undefined` when there's nothing to show
 * (not signed in, no household yet, or the member has notifications off). */
export function useReminderBadge(): number | undefined {
  const { session } = useAuth();
  const { membership } = useHousehold();
  const [count, setCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!session || !membership || membership === 'loading') {
      setCount(undefined);
      return;
    }

    let cancelled = false;
    const householdId = membership.householdId;
    const userId = session.user.id;

    async function refresh() {
      const enabled = await getMemberNotificationsEnabled(supabase, householdId, userId);
      if (cancelled) return;
      if (!enabled) {
        setCount(undefined);
        return;
      }

      // Computed live from pantry_items + the household's own thresholds —
      // the same status logic the Pantry screen's badges use — rather than
      // read from pantry_item_reminders, which is only refreshed once a day
      // by the cron job (or on-demand). Reading that table here would make
      // the badge up to a day stale relative to the Pantry screen itself.
      const [prefs, itemsResult] = await Promise.all([
        getHouseholdNotificationPrefs(supabase, householdId),
        supabase
          .from('pantry_items')
          .select('id, expiration_date, is_produce, notify_days_before_expiry')
          .eq('household_id', householdId)
          .eq('is_archived', false)
          .not('expiration_date', 'is', null),
      ]);
      if (cancelled) return;

      const matchCount = (itemsResult.data ?? []).filter((item) => {
        const threshold = resolveNotifyThreshold(
          { isProduce: item.is_produce, notifyDaysBeforeExpiry: item.notify_days_before_expiry },
          prefs
        );
        const status = getExpiryBadgeStatus(daysUntil(item.expiration_date), threshold);
        return status === 'warning' || status === 'expired';
      }).length;

      setCount(matchCount > 0 ? matchCount : undefined);
    }

    refresh();
    const unsubscribe = onNotificationsChanged(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [session, membership]);

  return count;
}
