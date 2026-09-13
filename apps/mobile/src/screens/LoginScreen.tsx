import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useAuth } from '../lib/AuthProvider';
import { AppButton } from '../components/AppButton';
import { color, cardStyle, inputStyle, font } from '../lib/theme';

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
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{mode === 'sign-in' ? 'Welcome back' : 'Create an account'}</Text>
        <Text style={styles.subtitle}>
          {mode === 'sign-in' ? 'Sign in to see your household’s pantry.' : 'Set up your household in a minute.'}
        </Text>
        <View style={styles.form}>
          <View>
            <Text style={styles.label}>Email</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={inputStyle}
            />
          </View>
          <View>
            <Text style={styles.label}>Password</Text>
            <TextInput secureTextEntry value={password} onChangeText={setPassword} style={inputStyle} />
          </View>
          {status && <Text style={styles.error}>{status}</Text>}
          <AppButton
            title={submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Sign up'}
            onPress={handleSubmit}
            disabled={submitting}
          />
        </View>
        <Text style={styles.link} onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: color.background },
  card: { ...cardStyle, padding: 24 },
  title: { fontSize: 22, fontFamily: font.bold, color: color.foreground },
  subtitle: { fontSize: 14, color: color.mutedForeground, marginTop: 6, fontFamily: font.regular },
  label: { fontSize: 13, fontFamily: font.semibold, color: color.mutedForeground, marginBottom: 6 },
  form: { gap: 16, marginTop: 20 },
  error: { color: color.destructive, fontSize: 13, fontFamily: font.regular },
  link: { color: color.primary, marginTop: 16, textAlign: 'center', fontFamily: font.semibold },
});
