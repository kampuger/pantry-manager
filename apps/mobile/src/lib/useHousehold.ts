import { useCallback, useEffect, useState } from 'react';
import { getMyHousehold, createHousehold, type HouseholdMembership } from '@pantry/supabase-client';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthProvider';

export function useHousehold() {
  const { session } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    getMyHousehold(supabase, session.user.id).then((result) => {
      if (!cancelled) setMembership(result);
    });

    return () => {
      cancelled = true;
    };
  }, [session]);

  const create = useCallback(
    async (name: string) => {
      if (!session) throw new Error('Not signed in');
      const result = await createHousehold(supabase, session.user.id, name.trim() || 'My Household');
      setMembership(result);
      return result;
    },
    [session]
  );

  return { membership, create };
}
