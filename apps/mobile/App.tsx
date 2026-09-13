import { View, ActivityIndicator } from 'react-native';
import { AuthProvider, useAuth } from './src/lib/AuthProvider';
import { BottomTabs } from './src/navigation/BottomTabs';
import { LoginScreen } from './src/screens/LoginScreen';
import { color, useAppFonts } from './src/lib/theme';

function Root() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.background }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  return session ? <BottomTabs /> : <LoginScreen />;
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.background }}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
