namespace DineFlow.Api.Authorization;

public static class RateLimitPolicies
{
    /// Anonymous guest order lookup and refund requests. These take a bearer token rather than a
    /// session, so throttling per IP is the backstop against brute-forcing a leaked order id.
    public const string GuestOrderAccess = "guest-order-access";
}
