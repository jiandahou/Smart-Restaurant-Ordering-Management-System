namespace DineFlow.Api.Services;

/// <summary>
/// The page an external sign-in should hand the customer back to.
/// </summary>
/// <remarks>
/// <para>
/// A customer who taps "Sign in" from a restaurant menu is trying to keep ordering, not to visit
/// their account. Password and passkey sign-in already carry a <c>returnTo</c> through to the
/// destination; Google and Facebook did not carry one at all, so every external sign-in ended on
/// the default landing page and the customer had to find the restaurant again.
/// </para>
/// <para>
/// The value survives a round trip through the provider, which means it comes back as something a
/// third party has had the opportunity to influence. It is therefore treated as untrusted: only a
/// relative path within this site is ever echoed back, so it cannot become a redirect to somebody
/// else's server. The browser applies its own, narrower rule afterwards — the frontend only follows
/// menu paths — but the server must not be the weak link that makes that the only check.
/// </para>
/// </remarks>
public static class OAuthReturnPath
{
    /// <summary>Long enough for a table QR path, short enough not to be a payload.</summary>
    public const int MaxLength = 512;

    /// <summary>
    /// The path to echo back to the frontend, or null when there is nothing safe to return to.
    /// </summary>
    public static string? Sanitize(string? returnTo)
    {
        if (string.IsNullOrWhiteSpace(returnTo) || returnTo.Length > MaxLength)
        {
            return null;
        }

        var candidate = returnTo.Trim();

        // Must be a path on this site. A protocol-relative "//evil.example.com" is somebody else's
        // server written to look like a path, and a backslash is treated as a slash by some
        // browsers — both would turn this into an open redirect.
        if (!candidate.StartsWith('/') ||
            candidate.StartsWith("//", StringComparison.Ordinal) ||
            candidate.StartsWith("/\\", StringComparison.Ordinal))
        {
            return null;
        }

        // Control characters, including the newlines that split a response header.
        if (candidate.Any(char.IsControl))
        {
            return null;
        }

        return candidate;
    }
}
