import { describe, expect, it } from 'vitest'

// Vite hands the file over as text; reading it through node would drag node's types into an app
// config that deliberately does not carry them.
import context from './RestaurantPrintingContext.tsx?raw'

/**
 * That the stored preference is actually consulted.
 *
 * <p>
 * The module's own tests check that a mute round-trips through storage. This checks the context
 * reads it before either alert loop can fire — a preference nothing loads is exactly the state the
 * defect was in, and it passes every test about the storage.
 * </p>
 */
describe('the printing context', () => {
  it('starts both sounds from what was stored, not from a hardcoded default', () => {
    expect(context).toContain('useState(storedSoundPreferences.newOrderSound)')
    expect(context).toContain('useState(storedSoundPreferences.unacceptedOrderAlert)')
  })

  it('seeds the refs the alert loops read, not only the rendered state', () => {
    // The loops consult refs, not state. Refs left at a hardcoded true would sound a muted alarm
    // once before the first effect caught up.
    expect(context).toContain('useRef(storedSoundPreferences.newOrderSound)')
    expect(context).toContain('useRef(storedSoundPreferences.unacceptedOrderAlert)')
    expect(context).not.toContain('const audioEnabledRef = useRef(true)')
    expect(context).not.toContain('const overdueAlertEnabledRef = useRef(true)')
  })

  it('writes the choice back when either sound is toggled', () => {
    expect(context).toContain('storeNotificationSoundPreferences({')
  })
})
