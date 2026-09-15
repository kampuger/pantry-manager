import { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useAuth } from '../lib/AuthProvider';
import { AppButton } from '../components/AppButton';
import { color, cardStyle, inputStyle, font } from '../lib/theme';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password';

export function LoginScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<Mode>('sign-in');
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setStatus(null);
    setStatusIsError(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setStatus(null);
    setStatusIsError(false);

    if (mode === 'forgot-password') {
      const result = await resetPassword(email);
      setSubmitting(false);
      setStatusIsError(!!result.error);
      setStatus(
        result.error ?? 'If that email has an account, a reset link is on its way — open it from your phone to finish, then come back and sign in.'
      );
      return;
    }

    const result = mode === 'sign-in' ? await signIn(email, password) : await signUp(email, password);

    setSubmitting(false);

    if (result.error) {
      setStatusIsError(true);
      setStatus(result.error);
      return;
    }

    if (mode === 'sign-up') {
      setStatus('Account created. If email confirmation is enabled on this project, check your inbox before signing in.');
    }
    // On sign-in success, AuthProvider's session state updates automatically
    // and BottomTabs re-renders to show the signed-in app.
  }

  const title = mode === 'sign-in' ? 'Welcome back' : mode === 'sign-up' ? 'Create an account' : 'Reset your password';
  const subtitle =
    mode === 'sign-in'
      ? 'Sign in to see your household’s pantry.'
      : mode === 'sign-up'
        ? 'Set up your household in a minute.'
        : 'Enter your email and we’ll send you a reset link.';
  const submitLabel = mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Sign up' : 'Send reset link';

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
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
          {mode !== 'forgot-password' && (
            <View>
              <Text style={styles.label}>Password</Text>
              <TextInput secureTextEntry value={password} onChangeText={setPassword} style={inputStyle} />
            </View>
          )}
          {mode === 'sign-in' && (
            <Text style={styles.forgotLink} onPress={() => switchMode('forgot-password')}>
              Forgot password?
            </Text>
          )}
          {status && <Text style={statusIsError ? styles.error : styles.success}>{status}</Text>}
          <AppButton title={submitting ? 'Please wait…' : submitLabel} onPress={handleSubmit} disabled={submitting} />
        </View>
        {mode === 'forgot-password' ? (
          <Text style={styles.link} onPress={() => switchMode('sign-in')}>
            Back to sign in
          </Text>
        ) : (
          <Text style={styles.link} onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </Text>
        )}
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
  success: { color: color.success, fontSize: 13, fontFamily: font.regular },
  link: { color: color.primary, marginTop: 16, textAlign: 'center', fontFamily: font.semibold },
  forgotLink: { color: color.primary, textAlign: 'right', fontSize: 13, fontFamily: font.medium },
});
