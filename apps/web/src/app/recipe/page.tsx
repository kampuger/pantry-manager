'use client';

import { useState } from 'react';
import { matchRecipeIngredients, type MatchedIngredient } from '@pantry/core';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthProvider';
import { useHousehold } from '@/lib/useHousehold';
import { CreateHouseholdPrompt } from '@/components/CreateHouseholdPrompt';

const STATUS_STYLES: Record<MatchedIngredient['status'], { background: string; color: string; label: string }> = {
  FULLY_AVAILABLE: { background: '#dcfce7', color: '#166534', label: 'Available' },
  PARTIALLY_AVAILABLE: { background: '#fef3c7', color: '#92400e', label: 'Partial' },
  MISSING: { background: '#fee2e2', color: '#b91c1c', label: 'Missing' },
};

function IngredientMatcher({ householdId }: { householdId: string }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState<MatchedIngredient[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('pantry_items')
        .select('name, quantity, unit')
        .eq('household_id', householdId)
        .eq('is_archived', false);

      if (fetchError) throw fetchError;

      setResults(matchRecipeIngredients(text, data ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check ingredients');
    } finally {
      setChecking(false);
    }
  }

  const missingCount = results?.filter((r) => r.status === 'MISSING').length ?? 0;

  return (
    <div>
      <p style={{ color: '#64748b', marginTop: 8, maxWidth: 560 }}>
        Paste a recipe&apos;s ingredient list below, one ingredient per line (e.g. &quot;2 tbsp butter&quot;), and
        check it against your pantry. Photo/OCR capture is on hold for now — paste the text directly.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'2 tbsp butter\n3 pcs onion\n1 kg rice\nsalt to taste'}
        rows={8}
        style={{ width: '100%', maxWidth: 480, marginTop: 16, padding: 12, fontFamily: 'inherit', fontSize: 14 }}
      />
      <div style={{ marginTop: 12 }}>
        <button
          onClick={handleCheck}
          disabled={checking || !text.trim()}
          style={{ padding: 8, cursor: 'pointer' }}
        >
          {checking ? 'Checking…' : 'Check ingredients'}
        </button>
      </div>
      {error && <p style={{ color: '#b91c1c', marginTop: 12 }}>{error}</p>}

      {results && (
        <div style={{ marginTop: 24, maxWidth: 560 }}>
          <h2 style={{ fontSize: 18 }}>
            {results.length} ingredient{results.length === 1 ? '' : 's'}
            {missingCount > 0 && ` — ${missingCount} missing`}
          </h2>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {results.map((r, i) => {
              const style = STATUS_STYLES[r.status];
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: '10px 16px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{r.rawLine}</div>
                    {r.matchedStock && (
                      <div style={{ color: '#64748b', fontSize: 13 }}>
                        In stock: {r.matchedStock.quantity} {r.matchedStock.unit} {r.matchedStock.name}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: style.background,
                      color: style.color,
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {style.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecipePage() {
  const { session, loading: authLoading } = useAuth();
  const { membership, create } = useHousehold();

  if (authLoading) return null;

  if (!session) {
    return (
      <div>
        <h1>Recipe Ingredient Checker</h1>
        <p style={{ color: '#64748b', marginTop: 8 }}>
          <a href="/login">Sign in</a> to check a recipe against your household&apos;s pantry.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Recipe Ingredient Checker</h1>
      {membership === 'loading' && <p style={{ marginTop: 20, color: '#64748b' }}>Loading…</p>}
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && <IngredientMatcher householdId={membership.householdId} />}
    </div>
  );
}
