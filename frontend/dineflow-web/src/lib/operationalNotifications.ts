export type OperationalSuccessEvent = {
  id: string
  title: string
  message: string
  createdAt: number
}

type OperationalSuccessListener = (event: OperationalSuccessEvent) => void
type OperationalStatusListener = (restaurantId?: string) => void

const listeners = new Set<OperationalSuccessListener>()
const statusListeners = new Set<OperationalStatusListener>()

export function publishOperationalSuccess(title: string, message: string): void {
  const event: OperationalSuccessEvent = {
    id: `success-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    message,
    createdAt: Date.now(),
  }

  listeners.forEach((listener) => listener(event))
}

export function subscribeOperationalSuccess(listener: OperationalSuccessListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishOperationalStatusInvalidated(restaurantId?: string): void {
  statusListeners.forEach((listener) => listener(restaurantId))
}

export function subscribeOperationalStatusInvalidated(listener: OperationalStatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}
