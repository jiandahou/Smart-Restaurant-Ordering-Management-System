namespace DineFlow.Infrastructure.Authentication;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = string.Empty;

    public string Audience { get; set; } = string.Empty;

    public string SecretKey { get; set; } = string.Empty;

    public int ExpirationMinutes { get; set; } = 60;

    /// <summary>How long a refresh token stays valid from the moment it is issued
    /// or rotated. Refreshing resets this window (sliding expiration), so a user
    /// who opens the app at least this often is never asked to log in again.</summary>
    public int RefreshTokenExpirationDays { get; set; } = 90;
}
