import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  defaultNotificationSoundPreferences,
  loadNotificationSoundPreferences,
  storeNotificationSoundPreferences,
} from './notificationSoundPreferences'

/**
 * Muting was page memory only: a refresh, or the reload after a deploy, turned the kitchen's alerts
 * back on. Someone silences the unaccepted-order klaxon because the tablet is in a dining room, and
 * an alert that comes back by itself gets solved at the volume knob instead — which silences every
 * other alert too.
 */
describe('notification sound preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('survives a reload', () => {
    storeNotificationSoundPreferences({ newOrderSound: false, unacceptedOrderAlert: false })

    expect(loadNotificationSoundPreferences()).toEqual({
      newOrderSound: false,
      unacceptedOrderAlert: false,
    })
  })

  it('keeps the two sounds apart', () => {
    // They are muted for different reasons: the chime is noise, the overdue alert is a klaxon.
    storeNotificationSoundPreferences({ newOrderSound: true, unacceptedOrderAlert: false })

    expect(loadNotificationSoundPreferences()).toEqual({
      newOrderSound: true,
      unacceptedOrderAlert: false,
    })
  })

  it('starts audible when nothing has been chosen', () => {
    expect(loadNotificationSoundPreferences()).toEqual(defaultNotificationSoundPreferences)
    expect(defaultNotificationSoundPreferences.newOrderSound).toBe(true)
  })

  // A key written by an older build, or absent, must not silence a kitchen by accident. Checked
  // for each sound in turn: one of them reading the other's key would go unnoticed otherwise.
  it.each([
    ['newOrderSound', { unacceptedOrderAlert: false }, { newOrderSound: true, unacceptedOrderAlert: false }],
    ['unacceptedOrderAlert', { newOrderSound: false }, { newOrderSound: false, unacceptedOrderAlert: true }],
  ] as const)('leaves %s audible when its key is absent', (_name, stored, expected) => {
    window.localStorage.setItem('dineflow.notificationSounds', JSON.stringify(stored))

    expect(loadNotificationSoundPreferences()).toEqual(expected)
  })

  it('falls back to audible on unreadable storage', () => {
    window.localStorage.setItem('dineflow.notificationSounds', 'not json')

    expect(loadNotificationSoundPreferences()).toEqual(defaultNotificationSoundPreferences)
  })

  it('does not break the screen when storage refuses the write', () => {
    // Private browsing and a full quota both throw here. Losing the preference is survivable;
    // taking the kitchen display down with it is not.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() =>
      storeNotificationSoundPreferences({ newOrderSound: false, unacceptedOrderAlert: false }),
    ).not.toThrow()

    setItem.mockRestore()
  })
})
