using System.Security.Cryptography;
using System.Text;

namespace DineFlow.Tests.Infrastructure;

/// <summary>
/// A Stripe webhook, signed the way Stripe signs one.
/// </summary>
/// <remarks>
/// Posted at the real endpoint rather than by calling the handler, because the signature check, the
/// event parsing and the transaction around the handler are all part of what has to keep working. A
/// test that skipped them would be testing a method that no webhook ever reaches.
/// </remarks>
public static class StripeWebhookRequest
{
    public static HttpRequestMessage Create(string payload, string secret, DateTimeOffset? at = null)
    {
        var timestamp = (at ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var signedPayload = $"{timestamp}.{payload}";
        var signature = Convert.ToHexString(
                HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(signedPayload)))
            .ToLowerInvariant();

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/payments/stripe/webhook")
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json")
        };
        request.Headers.Add("Stripe-Signature", $"t={timestamp},v1={signature}");
        return request;
    }
}
