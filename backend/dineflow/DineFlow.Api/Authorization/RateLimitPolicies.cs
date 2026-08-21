namespace DineFlow.Api.Authorization;

public static class RateLimitPolicies
{
    /// Anonymous guest order lookup and refund requests. These take a bearer token rather than a
    /// session, so throttling per IP is the backstop against brute-forcing a leaked order id.
    public const string GuestOrderAccess = "guest-order-access";

    /// Every anonymous credential check: password login, magic-link redemption, MFA verification,
    /// passkey assertion and OAuth code exchange. Caps how fast one source can guess; Identity's
    /// account lockout caps how often one account can be guessed at.
    public const string Authentication = "authentication";

    /// Token refresh and logout. These carry a credential, so they are throttled, but they are
    /// also routine background traffic — a restaurant whose staff share one outbound IP would be
    /// locked out of the app if they competed with the login budget.
    public const string TokenLifecycle = "token-lifecycle";

    /// Public cart endpoints. Partitioned by source *and cart*, because a cart participant token is
    /// the entire credential for a cart and the pages holding one poll every couple of seconds: a
    /// per-source cap strict enough to matter would take a busy restaurant's shared wifi offline.
    /// Per cart, the ceiling only has to sit above one table's polling. Guessing across many carts
    /// is caught by <c>CartTokenFailureTracker</c>, which counts failures rather than requests.
    public const string CartAccess = "cart-access";

    /// Endpoints that send mail to an address the caller supplies — magic links, password resets,
    /// confirmation resends. Throttled harder because the abuse here is using DineFlow to
    /// deliver unwanted mail, not guessing a secret.
    public const string AuthenticationEmail = "authentication-email";
}
