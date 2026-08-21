const oauthErrorMessages: Record<string, string> = {
  google_failed: 'Google sign-in failed. Please try again.',
  google_missing_profile: 'Google did not return your profile. Please try again.',
  google_create_failed: 'Could not create your account via Google. Please try again.',
  google_link_failed: 'Could not link your Google account. Please try again.',
  facebook_failed: 'Facebook sign-in failed. Please try again.',
  facebook_missing_profile: 'Facebook did not return your profile. Please try again.',
  facebook_create_failed: 'Could not create your account via Facebook. Please try again.',
  facebook_link_failed: 'Could not link your Facebook account. Please try again.',
  legal_consent_required: 'Accept the current Customer Terms and Privacy Policy before creating a social account.',
}

/**
 * The message for a provider redirect, or null when this was an ordinary visit to the login page.
 * An unrecognised code still produces something to read: the provider failed, and saying nothing
 * would leave the person staring at a login form with no idea why they are back on it.
 */
export function describeOauthError(code: string | null | undefined): string | null {
  if (!code) {
    return null
  }

  return oauthErrorMessages[code] ?? 'OAuth sign-in failed. Please try again.'
}
