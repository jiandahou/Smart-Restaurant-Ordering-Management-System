import { Link } from 'react-router-dom'

/**
 * What is said where an allergy gets typed in.
 *
 * <p>
 * Both note fields offer one-tap buttons labelled <i>Allergies</i> — Peanut allergy, Coeliac,
 * Shellfish allergy — so the product asks for health information directly. What it did not say is
 * what then happens to it: the note is shown to restaurant staff, printed onto the kitchen ticket,
 * and kept with the order. The privacy policy says all of that; a customer who has never opened it
 * has been told nothing at the moment they were asked.
 * </p>
 *
 * <p>
 * Someone tapping "Peanut allergy" is not making a considered disclosure decision — they are trying
 * not to be made ill. They are owed the plain fact that it gets printed on paper in a kitchen, at
 * the point where they can still decide what to write.
 * </p>
 *
 * <p>
 * Shared by both note fields on purpose. Two copies of a notice like this drift, and the one nobody
 * remembered to update is the one still being read.
 * </p>
 */
export function NoteHealthInfoNotice({ scope }: { scope: 'item' | 'order' }) {
  return (
    <div className="space-y-1 text-xs leading-5 text-muted-foreground">
      {/* Safety first: the limit of what a note can do, said where the allergy is being typed
          rather than inside a panel further up that opens only if someone taps it. */}
      <p>
        Tell the kitchen about allergies here. {scope === 'item' ? 'An item note' : 'An order note'}{' '}
        cannot guarantee prevention of{' '}
        <Link to="/allergen-information" target="_blank" className="underline">
          allergen cross-contact
        </Link>{' '}
        — for a severe allergy, contact the restaurant before ordering.
      </p>
      <p data-testid={`note-privacy-notice-${scope}`}>
        Anything you write here is shown to restaurant staff, printed on the kitchen ticket, and kept
        with your order. Please include only what the kitchen needs. See our{' '}
        <Link to="/privacy" target="_blank" className="underline">
          privacy policy
        </Link>{' '}
        for how long it is kept and how to ask for it to be removed.
      </p>
    </div>
  )
}
