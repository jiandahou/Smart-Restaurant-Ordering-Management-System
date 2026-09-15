namespace DineFlow.Application.Authentication;

public interface IJwtTokenService
{
    string GenerateToken(
        string userId,
        string? email,
        string? userName,
        IEnumerable<string> roles,
        string? securityStamp = null);
}

/// <summary>
/// Custom JWT claim types issued and validated by DineFlow.
/// </summary>
public static class DineFlowJwtClaims
{
    /// <summary>
    /// Carries the user's Identity security stamp at the moment the token was issued. Each request
    /// re-reads the stored stamp and rejects the token when it no longer matches, so disabling an
    /// account or changing its role/tenant invalidates every access token already in the wild
    /// instead of leaving them valid until natural expiry.
    /// </summary>
    public const string SecurityStamp = "dineflow:sstamp";
}
