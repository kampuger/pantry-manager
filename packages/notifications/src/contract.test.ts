// packages/notifications/src/contract.test.ts
import type { INotificationProvider } from './types';

class FakeNotificationProvider implements INotificationProvider {
  constructor(private granted: boolean) {}

  async requestPermission(): Promise<boolean> {
    return this.granted;
  }

  async registerForPush(): Promise<string | null> {
    if (!this.granted) return null;
    return 'ExponentPushToken[fake-token]';
  }
}

describe('INotificationProvider contract', () => {
  it('returns a token when permission is granted', async () => {
    const provider = new FakeNotificationProvider(true);
    expect(await provider.requestPermission()).toBe(true);
    expect(await provider.registerForPush()).toBe('ExponentPushToken[fake-token]');
  });

  it('returns null token when permission is denied', async () => {
    const provider = new FakeNotificationProvider(false);
    expect(await provider.requestPermission()).toBe(false);
    expect(await provider.registerForPush()).toBeNull();
  });
});
