namespace DineFlow.Api.Services;

/// <summary>
/// The OAuth callback URL is built from the incoming request, so a proxy that rewrites the Host
/// header silently decides what we hand the identity provider. When a dev proxy pointed at a Docker
/// service name, that was <c>http://backend:8080/...</c>, and Google refused every sign-in with a
/// generic policy error naming nothing — the internal hostname never appeared anywhere we could see.
///
/// <para>
/// These are the provider rules: HTTPS, unless the host is a loopback address. Checking them
/// ourselves turns a dead end at the provider into a line in our own logs.
/// </para>
/// </summary>
public static class OAuthCallbackPolicy
{
    private static readonly string[] LoopbackHosts = ["localhost", "127.0.0.1", "[::1]", "::1"];

    /// <summary>The reason this callback will be rejected, or null when it is acceptable.</summary>
    public static string? DescribeProblem(string? scheme, string? host, string callbackPath)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            return $"The OAuth callback has no host, so \"{callbackPath}\" cannot be resolved to an "
                + "absolute URL. Check that forwarded headers reach the app.";
        }

        if (string.Equals(scheme, "https", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (LoopbackHosts.Contains(StripPort(host), StringComparer.OrdinalIgnoreCase))
        {
            return null;
        }

        return $"The OAuth callback resolves to {scheme}://{host}{callbackPath}. Providers only "
            + "accept http for loopback addresses, so this sign-in will be rejected. It usually "
            + "means a proxy rewrote the Host header — check changeOrigin in the dev proxy, or "
            + "X-Forwarded-Proto and X-Forwarded-Host behind a load balancer.";
    }

    /// <summary>An IPv6 literal keeps its brackets and its own colons, so a plain split will not do.</summary>
    private static string StripPort(string host)
    {
        if (host.StartsWith('['))
        {
            var closing = host.IndexOf(']');
            return closing < 0 ? host : host[..(closing + 1)];
        }

        var separator = host.IndexOf(':');
        return separator < 0 ? host : host[..separator];
    }
}
