import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import type { Cart, SubmittedOrder } from '@/api/carts'

const realtimeBaseUrl = (import.meta.env.VITE_SIGNALR_BASE_URL || '').replace(/\/$/, '')

export type CartRealtimeUpdate = {
  reason: string
  cart: Cart | null
}

export type CartSubmittedUpdate = {
  cart: Cart
  order: SubmittedOrder
}

export type CartItemAddedUpdate = {
  actorParticipantId: string
  actorName: string
  itemName: string
  quantity: number
}

export type CartRealtimeHandlers = {
  onCartUpdated: (update: CartRealtimeUpdate) => void
  onCartItemAdded?: (update: CartItemAddedUpdate) => void
  onCartExpired?: () => void
  onCartSubmitted?: (update: CartSubmittedUpdate) => void
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
    .withUrl(`${realtimeBaseUrl}/api/hubs/carts`)
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(LogLevel.Warning)
    .build()

  connection.on('CartUpdated', handlers.onCartUpdated)
  connection.on('CartItemAdded', (update: CartItemAddedUpdate) => {
    console.debug('[SignalR] CartItemAdded received', update)
    handlers.onCartItemAdded?.(update)
  })
  connection.on('CartExpired', () => handlers.onCartExpired?.())
  connection.on('CartSubmitted', (update: CartSubmittedUpdate) =>
    handlers.onCartSubmitted?.(update),
  )

  connection.onreconnected(async () => {
    try {
      await connection.invoke('JoinCart', cartId, participantToken)
      await handlers.onReconnected?.()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SignalR] ❌ JoinCart failed on reconnect: ${msg}`, err)
    }
  })

  return {
    connection,
    start: async () => {
      if (connection.state !== HubConnectionState.Disconnected) {
        return
      }

      try {
        await connection.start()
        console.log('[SignalR] Connecting: cartId =', cartId, '| tokenLen =', participantToken?.length)
        await connection.invoke('JoinCart', cartId, participantToken)
        console.log('[SignalR] ✅ JoinCart succeeded')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const lines = msg.split('\n')
        const serverMsg = lines.length > 1 ? lines.slice(1).join(' ') : '(no server detail)'
        console.error(`[SignalR] ❌ JoinCart failed — server says: "${serverMsg}"`, err)
        throw err
      }
    },
    stop: async () => {
      if (connection.state === HubConnectionState.Connected) {
        await connection.invoke('LeaveCart', cartId).catch(() => undefined)
      }

      await connection.stop()
    },
  }
}
