import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr'
import { getStoredToken } from '@/api/auth'

const realtimeBaseUrl = (import.meta.env.VITE_SIGNALR_BASE_URL || '').replace(/\/$/, '')

export type OrderRealtimeUpdate = {
  reason: string
  orderId: string
  restaurantId: string | null
  orderNumber: string
  status: string
  paymentStatus: string
  paymentMethod: string
  occurredAt: string
}

export type OrderRealtimeHandlers = {
  onOrderCreated?: (update: OrderRealtimeUpdate) => void
  onOrderUpdated?: (update: OrderRealtimeUpdate) => void
  onOrderPaymentUpdated?: (update: OrderRealtimeUpdate) => void
  onOrderDeleted?: (update: OrderRealtimeUpdate) => void
  onConnected?: () => void | Promise<void>
  onReconnecting?: (error?: Error) => void | Promise<void>
  onReconnected?: () => void | Promise<void>
  onClosed?: (error?: Error) => void | Promise<void>
}

export type OrderRealtimeClient = {
  connection: HubConnection
  start: () => Promise<void>
  stop: () => Promise<void>
}

export function createOrderRealtimeClient(handlers: OrderRealtimeHandlers): OrderRealtimeClient {
  const connection = new HubConnectionBuilder()
    .withUrl(`${realtimeBaseUrl}/api/hubs/orders`, {
      accessTokenFactory: () => getStoredToken() ?? '',
    })
    .withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])
    .configureLogging(import.meta.env.DEV ? LogLevel.Information : LogLevel.Warning)
    .build()

  connection.on('OrderCreated', (update: OrderRealtimeUpdate) =>
    handlers.onOrderCreated?.(update),
  )
  connection.on('OrderUpdated', (update: OrderRealtimeUpdate) =>
    handlers.onOrderUpdated?.(update),
  )
  connection.on('OrderPaymentUpdated', (update: OrderRealtimeUpdate) =>
    handlers.onOrderPaymentUpdated?.(update),
  )
  connection.on('OrderDeleted', (update: OrderRealtimeUpdate) =>
    handlers.onOrderDeleted?.(update),
  )

  connection.onreconnecting(async (error) => {
    await handlers.onReconnecting?.(error)
  })

  connection.onreconnected(async () => {
    await handlers.onReconnected?.()
  })

  connection.onclose(async (error) => {
    await handlers.onClosed?.(error)
  })

  return {
    connection,
    start: async () => {
      if (connection.state !== HubConnectionState.Disconnected) {
        return
      }

      await connection.start()
      await handlers.onConnected?.()
    },
    stop: async () => {
      await connection.stop()
    },
  }
}
