import { View, Text } from 'react-native';
import { formatPHP } from '@pantry/core';

export function FinancialsScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Financial snapshot: {formatPHP(0)}</Text>
    </View>
  );
}
