/**
 * Whether this device plays the kitchen's notification sounds.
 *
 * <p>
 * Muting was page memory only, so a refresh — or the automatic reload after a deploy — turned the
 * sound back on. A muted alert is not a cosmetic preference: someone silences the unaccepted-order
 * klaxon because the tablet sits in a dining room, and having it come back on by itself is the kind
 * of thing that gets the volume turned down at the hardware instead, which silences everything.
 * </p>
 *
 * <p>
 * Kept per device rather than per account. Two staff share one kitchen tablet and one dining-room
 * tablet; the question "should this screen make noise" belongs to the room it is in, not to whoever
 * happened to log in.
 * </p>
 */

const storageKey = 'dineflow.notificationSounds'

export type NotificationSoundPreferences = {
  /** The chime when an order arrives. */
  newOrderSound: boolean
  /** The repeating alert for an order nobody has accepted. */
  unacceptedOrderAlert: boolean
}

/** Both on. A restaurant that has never chosen should hear its orders arrive. */
export const defaultNotificationSoundPreferences: NotificationSoundPreferences = {
  newOrderSound: true,
  unacceptedOrderAlert: true,
}

export function loadNotificationSoundPreferences(): NotificationSoundPreferences {
  if (typeof window === 'undefined') {
    return { ...defaultNotificationSoundPreferences }
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { ...defaultNotificationSoundPreferences }

    const stored = JSON.parse(raw) as Partial<NotificationSoundPreferences>

    return {
      // Only an explicit false mutes. Anything else — a missing key, a value written by an older
      // build, a hand-edited string — falls back to hearing the order, which is the safe way to be
      // wrong.
      newOrderSound: stored.newOrderSound !== false,
      unacceptedOrderAlert: stored.unacceptedOrderAlert !== false,
    }
  } catch {
    return { ...defaultNotificationSoundPreferences }
  }
}

export function storeNotificationSoundPreferences(preferences: NotificationSoundPreferences): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // A full or blocked store is not worth breaking the screen over; the sound simply reverts to
    // the default on the next load, which is what happened before this existed.
  }
}
