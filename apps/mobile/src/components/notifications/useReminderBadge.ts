import { useEffect, useState } from 'react';
import { getPantryItemReminders, getMemberNotificationsEnabled } from '@pantry/supabase-client';
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
      const reminders = await getPantryItemReminders(supabase, householdId);
      if (!cancelled) setCount(reminders.length > 0 ? reminders.length : undefined);
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
