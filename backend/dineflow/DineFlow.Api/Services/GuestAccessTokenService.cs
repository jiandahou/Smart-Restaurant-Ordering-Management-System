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
    /// Whether the caller holds the secret this order was issued.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Compared in fixed time so the API cannot be used as an oracle to recover a token byte by
    /// byte.
    /// </para>
    /// <para>
    /// A blank stored hash means no credential was ever issued for this order, which was true of
    /// the guest orders placed in the days before tokens existed. Those were let through on the
    /// order id alone so customers mid-order did not lose access, with the note that it should be
    /// tightened once they had aged out. They have: the last of them was placed on 8 August 2026,
    /// and nine remain. Until now the id alone authorised reading an order and filing a refund
    /// request against it — an order id is a thing that ends up in browser histories, screenshots
    /// and shared links, and it is not a credential.
    /// </para>
    /// <para>
    /// Signed-in customers are unaffected: their orders carry no hash either, and every caller
    /// checks ownership against the account first and only reaches this when there is no account
    /// behind the order at all.
    /// </para>
    /// </remarks>
    public static bool IsAuthorized(string? storedHash, string? providedToken)
    {
        if (string.IsNullOrWhiteSpace(storedHash) || string.IsNullOrWhiteSpace(providedToken))
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
