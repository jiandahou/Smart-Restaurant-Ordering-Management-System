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
    .configureLogging(import.meta.env.DEV ? LogLevel.Information : LogLevel.Warning)
    .build()

  connection.on('CartUpdated', handlers.onCartUpdated)
  connection.on('CartItemAdded', (update: CartItemAddedUpdate) =>
    handlers.onCartItemAdded?.(update),
  )
  connection.on('CartExpired', () => handlers.onCartExpired?.())
  connection.on('CartSubmitted', (update: CartSubmittedUpdate) =>
    handlers.onCartSubmitted?.(update),
  )

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
