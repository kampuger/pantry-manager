import { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { useAuth } from '../lib/AuthProvider';

export function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setStatus(null);

    const result = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);

    setSubmitting(false);

    if (result.error) {
      setStatus(result.error);
      return;
    }

    if (mode === 'sign-up') {
      setStatus('Account created. If email confirmation is enabled on this project, check your inbox before signing in.');
    }
    // On sign-in success, AuthProvider's session state updates automatically
    // and BottomTabs re-renders to show the signed-in app.
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in' : 'Create an account'}</Text>
      <TextInput
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        style={styles.input}
      />
      <TextInput
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        style={styles.input}
      />
      {status && <Text style={styles.error}>{status}</Text>}
      <Button
        title={submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
        onPress={handleSubmit}
        disabled={submitting}
      />
      <Text
        style={styles.link}
        onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
      >
        {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12 },
  error: { color: '#b91c1c' },
  link: { color: '#2563eb', marginTop: 12, textAlign: 'center' },
});
