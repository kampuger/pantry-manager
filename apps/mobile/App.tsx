import { View, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from './src/lib/AuthProvider';
import { BottomTabs } from './src/navigation/BottomTabs';
import { LoginScreen } from './src/screens/LoginScreen';

function Root() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return session ? <BottomTabs /> : <LoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
