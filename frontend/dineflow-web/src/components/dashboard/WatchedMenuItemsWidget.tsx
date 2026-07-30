import { useCallback, useEffect, useState } from 'react'
import { EyeOff, Infinity as InfinityIcon, Minus, Plus, Star } from 'lucide-react'
import { toast } from 'sonner'
import {
  getWatchedMenuItems,
  updateMenuItemAvailability,
  updateMenuItemStock,
  updateMenuItemWatch,
  type WatchedMenuItem,
} from '../../api/auth'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Switch } from '../ui/switch'

/**
 * The handful of menu items staff want within reach — typically the ones that run out. Availability
 * flips and stock adjustments happen here so nobody has to open the full menu editor mid-service.
 *
 * Stock is opt-in per item: an untracked item shows as unlimited and only its availability toggle
 * matters.
 */
export function WatchedMenuItemsWidget({
  restaurantId,
  currency,
}: {
  restaurantId: string | null
  currency: string
}) {
  const [items, setItems] = useState<WatchedMenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)

    try {
      setItems(await getWatchedMenuItems(restaurantId ?? undefined))
    } catch (error) {
      toast.error('Could not load watched menu items', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const patchItem = (itemId: string, patch: Partial<WatchedMenuItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    )
  }

  const toggleAvailability = async (item: WatchedMenuItem) => {
    setBusyId(item.id)

    try {
      const response = await updateMenuItemAvailability(item.id, !item.isAvailable)
      patchItem(item.id, { isAvailable: response.isAvailable })
    } catch (error) {
      toast.error('Could not change availability', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const changeStock = async (item: WatchedMenuItem, stockQuantity: number | null) => {
    setBusyId(item.id)

    try {
      const response = await updateMenuItemStock(item.id, stockQuantity)
      patchItem(item.id, {
        stockQuantity: response.stockQuantity,
        isSoldOut: response.isSoldOut,
      })
    } catch (error) {
      toast.error('Could not change stock', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const unwatch = async (item: WatchedMenuItem) => {
    setBusyId(item.id)

    try {
      await updateMenuItemWatch(item.id, false)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (error) {
      toast.error('Could not unwatch the item', {
        description: error instanceof Error ? error.message : 'The request failed.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const formatPrice = (value: number) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(value)

  return (
    <Card className="dashboard-panel-card">
      <CardHeader>
        <div className="admin-page-title">
          <Star size={22} />
          <div>
            <CardTitle>Watched menu items</CardTitle>
            <CardDescription>Take items off the menu or top up stock without leaving the dashboard.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="dashboard-empty-state">Loading watched items...</div>
        ) : items.length === 0 ? (
          <div className="dashboard-empty-state">
            Nothing is being watched yet. Star an item on the Menu page to pin it here.
          </div>
        ) : (
          <div className="watched-item-list">
            {items.map((item) => {
              const busy = busyId === item.id
              const tracked = item.stockQuantity !== null

              return (
                <div
                  key={item.id}
                  className={`watched-item${item.isSoldOut ? ' is-sold-out' : ''}`}
                >
                  <div className="watched-item-copy">
                    <strong>{item.name}</strong>
                    <span>
                      {item.categoryName || 'Uncategorised'} · {formatPrice(item.price)}
                    </span>
                  </div>

                  <div className="watched-item-stock">
                    {tracked ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Decrease ${item.name} stock`}
                          disabled={busy || item.stockQuantity === 0}
                          onClick={() => void changeStock(item, Math.max(0, (item.stockQuantity ?? 0) - 1))}
                        >
                          <Minus size={14} />
                        </Button>
                        <strong aria-label={`${item.name} stock`}>{item.stockQuantity}</strong>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Increase ${item.name} stock`}
                          disabled={busy}
                          onClick={() => void changeStock(item, (item.stockQuantity ?? 0) + 1)}
                        >
                          <Plus size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          title="Stop tracking stock for this item"
                          onClick={() => void changeStock(item, null)}
                        >
                          <InfinityIcon size={14} />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        title="Start tracking stock for this item"
                        onClick={() => void changeStock(item, 10)}
                      >
                        <InfinityIcon size={14} />
                        Unlimited
                      </Button>
                    )}
                  </div>

                  <div className="watched-item-state">
                    {item.isSoldOut ? <Badge variant="destructive">Sold out</Badge> : null}
                    <Switch
                      checked={item.isAvailable}
                      disabled={busy}
                      aria-label={`${item.name} available`}
                      onCheckedChange={() => void toggleAvailability(item)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      aria-label={`Stop watching ${item.name}`}
                      title="Stop watching"
                      onClick={() => void unwatch(item)}
                    >
                      <EyeOff size={15} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
