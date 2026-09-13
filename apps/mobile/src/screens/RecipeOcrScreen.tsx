// Photo/OCR capture is on hold — @pantry/ocr's package.json resolution has a
// known, still-open issue on the Next.js web build (see packages/ocr) and
// wiring up the camera flow is separate scope. This screen instead accepts
// pasted recipe text directly, which needs no OCR at all.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { matchRecipeIngredients, type MatchedIngredient } from '@pantry/core';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthProvider';
import { useHousehold } from '../lib/useHousehold';
import { CreateHouseholdPrompt } from '../components/CreateHouseholdPrompt';
import { Badge } from '../components/Badge';
import { AppButton } from '../components/AppButton';
import { color, cardStyle, font } from '../lib/theme';

const STATUS_TONE: Record<MatchedIngredient['status'], { tone: 'success' | 'warning' | 'destructive'; label: string }> = {
  FULLY_AVAILABLE: { tone: 'success', label: 'Available' },
  PARTIALLY_AVAILABLE: { tone: 'warning', label: 'Partial' },
  MISSING: { tone: 'destructive', label: 'Missing' },
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
      <Text style={styles.meta}>
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
      <AppButton title={checking ? 'Checking…' : 'Check ingredients'} onPress={handleCheck} disabled={checking || !text.trim()} />
      {error && <Text style={styles.error}>{error}</Text>}

      {results && (
        <View style={{ gap: 10 }}>
          <Text style={styles.resultsTitle}>
            {results.length} ingredient{results.length === 1 ? '' : 's'}
            {missingCount > 0 ? ` — ${missingCount} missing` : ''}
          </Text>
          {results.map((r, i) => {
            const status = STATUS_TONE[r.status];
            return (
              <View key={i} style={styles.resultRow}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.resultLine}>{r.rawLine}</Text>
                  {r.matchedStock && (
                    <Text style={styles.meta}>
                      In stock: {r.matchedStock.quantity} {r.matchedStock.unit} {r.matchedStock.name}
                    </Text>
                  )}
                </View>
                <Badge tone={status.tone}>{status.label}</Badge>
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
      <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
        <Text style={styles.title}>Recipe Ingredient Checker</Text>
        <Text style={styles.meta}>Sign in to check a recipe against your household&apos;s pantry.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recipe Ingredient Checker</Text>
      {membership === null && <CreateHouseholdPrompt onCreate={create} />}
      {membership && membership !== 'loading' && <IngredientMatcher householdId={membership.householdId} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: color.background },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 26, fontFamily: font.bold, color: color.foreground, marginBottom: 8 },
  meta: { color: color.mutedForeground, fontSize: 13, fontFamily: font.regular },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
  textarea: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: 8,
    padding: 12,
    minHeight: 140,
    textAlignVertical: 'top',
    fontFamily: font.regular,
    color: color.foreground,
    backgroundColor: color.card,
  },
  resultsTitle: { fontSize: 15, fontFamily: font.bold, color: color.foreground },
  resultLine: { fontFamily: font.semibold, color: color.foreground },
  resultRow: {
    ...cardStyle,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    gap: 8,
  },
});
