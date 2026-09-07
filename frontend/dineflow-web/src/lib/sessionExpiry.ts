import { ApiError } from '../api/auth'

/**
 * Whether a failed request means the session is over, or only that the server could not be reached.
 *
 * <p>
 * Loading the current user runs on every page load, and its failure used to clear the session
 * outright — on the reasoning that a silent refresh had already been tried, so anything left must be
 * a dead token. That holds only when the server answered. A backend restarting, a dropped wifi, a
 * gateway blinking: all of them threw here too, and a restaurant's till dropped to the login screen
 * mid-service because the network hiccuped.
 * </p>
 *
 * <p>
 * So the question is narrowed to the one the server can answer. 401 and 403 after a refresh has
 * already been attempted mean the credentials are no longer good. Everything else — no response, a
 * 5xx, a timeout — leaves the session alone and lets the page retry.
 * </p>
 *
 * <p>
 * "After a refresh has already been attempted" was the part that did not hold. The attempt can end
 * without a verdict: a sibling tab rotates the shared token first, and the server answers 409 with
 * retry:true precisely to say the session is fine. That outcome arrived here as an ordinary 401 and
 * ended the session anyway — the customer who had just paid came back to My Orders signed out, with
 * their order replaced by whatever the browser had saved for guests, and no message to say why.
 * A refresh that never got an answer is not an answer.
 * </p>
 */
export function isSessionRejected(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    // No status at all: the request never got an answer. Nothing was rejected.
    return false
  }

  if (error.sessionVerdictUnknown) {
    return false
  }

  return error.status === 401 || error.status === 403
}
