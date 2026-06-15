import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import type { Cart } from '@/api/carts'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export type CartRealtimeUpdate = {
  reason: string
  cart: Cart | null
}

export type CartRealtimeHandlers = {
  onCartUpdated: (update: CartRealtimeUpdate) => void
  onCartExpired?: () => void
  onCartSubmitted?: (cart: Cart | null) => void
  onReconnected?: () => void | Promise<void>
}

export type CartRealtimeClient = {
  connection: HubConnection
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function createCartRealtimeClient(
  cartId: string,
  participantToken: string,
  handlers: CartRealtimeHandlers,
): CartRealtimeClient {
  const connection = new HubConnectionBuilder()
    .withUrl(`${apiBaseUrl}/api/hubs/carts`)
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(import.meta.env.DEV ? LogLevel.Information : LogLevel.Warning)
    .build()

  connection.on('CartUpdated', handlers.onCartUpdated)
  connection.on('CartExpired', () => handlers.onCartExpired?.())
  connection.on('CartSubmitted', (cart: Cart | null) => handlers.onCartSubmitted?.(cart))

  connection.onreconnected(async () => {
    await connection.invoke('JoinCart', cartId, participantToken)
    await handlers.onReconnected?.()
  })

  return {
    connection,
    start: async () => {
      if (connection.state !== HubConnectionState.Disconnected) {
        return
      }

      await connection.start()
      await connection.invoke('JoinCart', cartId, participantToken)
    },
    stop: async () => {
      if (connection.state === HubConnectionState.Connected) {
        await connection.invoke('LeaveCart', cartId).catch(() => undefined)
      }

      await connection.stop()
    },
  }
}
