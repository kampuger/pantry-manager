// packages/notifications/src/notifications.native.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import type { INotificationProvider } from './types';

export const notificationProvider: INotificationProvider = {
  async requestPermission(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  },

  async registerForPush(): Promise<string | null> {
    if (!Device.isDevice) return null; // push tokens are not available on simulators

    const granted = await this.requestPermission();
    if (!granted) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    return token;
  },
};
