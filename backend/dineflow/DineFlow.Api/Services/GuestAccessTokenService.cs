using System.Security.Cryptography;
using System.Text;

namespace DineFlow.Api.Services;

/// <summary>
/// Issues and checks the bearer secret for guest orders.
///
/// Only the hash is stored, so a database or log leak cannot be replayed against the API. The
/// plaintext is returned exactly once, at order creation, and lives only in the customer's browser.
/// </summary>
public static class GuestAccessTokenService
{
    private const int TokenByteLength = 32;

    /// <returns>The plaintext to hand to the caller, and the hash to persist.</returns>
    public static (string Token, string Hash) Issue()
    {
        var token = Base64UrlEncode(RandomNumberGenerator.GetBytes(TokenByteLength));
        return (token, ComputeHash(token));
    }

    public static string ComputeHash(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    /// <summary>
    /// Compared in fixed time so the API cannot be used as an oracle to recover a token byte by
    /// byte. A null or blank stored hash means the order predates guest tokens — those stay
    /// readable by id so existing customers do not lose access mid-order. Tighten this once the
    /// pre-token orders have aged out.
    /// </summary>
    public static bool IsAuthorized(string? storedHash, string? providedToken)
    {
        if (string.IsNullOrWhiteSpace(storedHash))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(providedToken))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(ComputeHash(providedToken)),
            Encoding.UTF8.GetBytes(storedHash));
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
}
