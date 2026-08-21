import { z } from 'zod'

/**
 * Matches AccountFieldLimits.FullNameMaxLength on the server. Long enough for a full legal name
 * with titles and multiple given names, short enough to stay displayable on an order ticket.
 */
export const fullNameMaximumLength = 100

/**
 * Trims before validating, so a name of nothing but spaces is required-field-empty rather than a
 * hundred characters of nothing. The trimmed value is what the form then submits.
 */
export function fullNameSchema(requiredMessage = 'Full name is required.') {
  return z
    .string()
    .trim()
    .min(1, requiredMessage)
    .max(fullNameMaximumLength, `Full name must be ${fullNameMaximumLength} characters or fewer.`)
}

/**
 * For the admin edit form, where a blank name means "leave it as it was" rather than "clear it".
 * Only the maximum applies.
 */
export function optionalFullNameSchema() {
  return z
    .string()
    .trim()
    .max(fullNameMaximumLength, `Full name must be ${fullNameMaximumLength} characters or fewer.`)
}
