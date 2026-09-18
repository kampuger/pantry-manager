'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMyHousehold,
  createHousehold,
  redeemHouseholdInvite,
  getMyApplicationInviteCode,
  type HouseholdMembership,
} from '@pantry/supabase-client';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthProvider';

export function useHousehold() {
  const { session } = useAuth();
  const [membership, setMembership] = useState<HouseholdMembership | null | 'loading'>('loading');

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    setMembership('loading');

    (async () => {
      const existing = await getMyHousehold(supabase, session.user.id);
      if (existing) {
        if (!cancelled) setMembership(existing);
        return;
      }
      try {
        const code = session.user.email ? await getMyApplicationInviteCode(supabase, session.user.email) : null;
        if (code) {
          const joined = await redeemHouseholdInvite(supabase, code);
          if (!cancelled) setMembership(joined);
          return;
        }
      } catch {
        // Invalid, expired, or already-used code, or the lookup itself
        // failed — fall through to the normal create/join prompt rather
        // than blocking the user on a code they don't control, and never
        // surface this error to someone who didn't type anything
        // themselves.
      }
      if (!cancelled) setMembership(null);
    })();

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

  const join = useCallback(
    async (code: string) => {
      if (!session) throw new Error('Not signed in');
      const result = await redeemHouseholdInvite(supabase, code);
      setMembership(result);
      return result;
    },
    [session]
  );

  return { membership, create, join };
}
