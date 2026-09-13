import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DashboardScreen } from '../screens/DashboardScreen';
import { PantryScreen } from '../screens/PantryScreen';
import { RecipeOcrScreen } from '../screens/RecipeOcrScreen';
import { ShoppingListScreen } from '../screens/ShoppingListScreen';
import { FinancialsScreen } from '../screens/FinancialsScreen';

const Tab = createBottomTabNavigator();

export function BottomTabs() {
  return (
    <NavigationContainer>
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="Home" component={DashboardScreen} />
        <Tab.Screen name="Pantry" component={PantryScreen} />
        <Tab.Screen name="Recipe" component={RecipeOcrScreen} />
        <Tab.Screen name="Shop" component={ShoppingListScreen} />
        <Tab.Screen name="Financial" component={FinancialsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
