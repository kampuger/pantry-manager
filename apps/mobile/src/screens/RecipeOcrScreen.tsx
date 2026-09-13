// Photo/OCR capture is on hold — @pantry/ocr's package.json resolution has a
// known, still-open issue on the Next.js web build (see packages/ocr) and
// wiring up the camera flow is separate scope. This screen instead accepts
// pasted recipe text directly, which needs no OCR at all.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Button } from 'react-native';
import { matchRecipeIngredients, type MatchedIngredient } from '@pantry/core';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';

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
    if (!text.trim()) return;
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
    <View style={{ gap: 12 }}>
      <Text style={{ color: '#64748b' }}>
        Paste a recipe&apos;s ingredient list below, one per line (e.g. &quot;2 tbsp butter&quot;), and check it
        against your pantry. Photo/OCR capture is on hold for now.
      </Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={'2 tbsp butter\n3 pcs onion\n1 kg rice\nsalt to taste'}
        multiline
        numberOfLines={8}
        style={styles.textarea}
      />
      <Button title={checking ? 'Checking…' : 'Check ingredients'} onPress={handleCheck} disabled={checking || !text.trim()} />
      {error && <Text style={{ color: '#b91c1c' }}>{error}</Text>}

      {results && (
        <View style={{ gap: 10 }}>
          <Text style={styles.resultsTitle}>
            {results.length} ingredient{results.length === 1 ? '' : 's'}
            {missingCount > 0 ? ` — ${missingCount} missing` : ''}
          </Text>
          {results.map((r, i) => {
            const style = STATUS_STYLES[r.status];
            return (
              <View key={i} style={styles.resultRow}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={{ fontWeight: '600' }}>{r.rawLine}</Text>
                  {r.matchedStock && (
                    <Text style={{ color: '#64748b', fontSize: 13 }}>
                      In stock: {r.matchedStock.quantity} {r.matchedStock.unit} {r.matchedStock.name}
                    </Text>
                  )}
                </View>
                <Text style={[styles.badge, { backgroundColor: style.background, color: style.color }]}>
                  {style.label}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function RecipeOcrScreen() {
  const { session } = useAuth();
  const { membership, create } = useHousehold();

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Recipe Ingredient Checker</Text>
        <Text style={{ color: '#64748b' }}>Sign in to check a recipe against your household&apos;s pantry.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recipe Ingredient Checker</Text>
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && <IngredientMatcher householdId={membership.householdId} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  textarea: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, minHeight: 140, textAlignVertical: 'top' },
  resultsTitle: { fontSize: 16, fontWeight: '700' },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  badge: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: '600' },
});
