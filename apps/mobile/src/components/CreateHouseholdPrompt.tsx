import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';

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
    <View style={styles.container}>
      <Text>You&apos;re signed in, but not part of a household yet.</Text>
      <TextInput placeholder="Household name" value={name} onChangeText={setName} style={styles.input} />
      {error && <Text style={{ color: '#b91c1c' }}>{error}</Text>}
      <Button title={submitting ? 'Creating…' : 'Create household'} onPress={handleSubmit} disabled={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12 },
});
