// packages/notifications/src/notifications.web.ts
import type { INotificationProvider } from './types';

export const notificationProvider: INotificationProvider = {
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;

    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  async registerForPush(): Promise<string | null> {
    const granted = await this.requestPermission();
    if (!granted) return null;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription ? JSON.stringify(subscription) : null;
  },
};
