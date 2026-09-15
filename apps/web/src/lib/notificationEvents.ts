type Listener = () => void;
const listeners = new Set<Listener>();

export function onNotificationsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNotificationsChanged(): void {
  listeners.forEach((listener) => listener());
}
