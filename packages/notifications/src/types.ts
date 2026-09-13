export interface INotificationProvider {
  requestPermission(): Promise<boolean>;
  registerForPush(): Promise<string | null>;
}
