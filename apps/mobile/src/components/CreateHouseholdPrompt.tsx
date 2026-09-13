import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { AppButton } from './AppButton';
import { color, cardStyle, inputStyle, font } from '../lib/theme';

export function CreateHouseholdPrompt({ onCreate }: { onCreate: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Set up your household</Text>
      <Text style={styles.subtitle}>You&apos;re signed in, but not part of a household yet.</Text>
      <View style={styles.form}>
        <TextInput
          placeholder="e.g. The Santos Family"
          value={name}
          onChangeText={setName}
          style={inputStyle}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <AppButton title={submitting ? 'Creating…' : 'Create household'} onPress={handleSubmit} disabled={submitting} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, padding: 20 },
  title: { fontFamily: font.semibold, fontSize: 15, color: color.foreground },
  subtitle: { fontFamily: font.regular, fontSize: 13, color: color.mutedForeground, marginTop: 4 },
  form: { gap: 12, marginTop: 16 },
  error: { color: color.destructive, fontFamily: font.regular, fontSize: 13 },
});
