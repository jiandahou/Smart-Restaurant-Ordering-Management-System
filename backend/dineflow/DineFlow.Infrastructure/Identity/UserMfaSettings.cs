namespace DineFlow.Infrastructure.Identity;

public sealed class UserMfaSettings
{
    public string UserId { get; set; } = string.Empty;

    public ApplicationUser User { get; set; } = null!;

    public bool TotpEnabled { get; set; }

    public string? TotpSecret { get; set; }

    public bool EmailEnabled { get; set; }

    public string PreferredMethod { get; set; } = MfaMethods.Totp;

    public bool RequireForLogin { get; set; }

    public bool RequireForPayment { get; set; }

    public bool RequireForSensitiveActions { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }
}

public static class MfaMethods
{
    public const string Totp = "totp";
    public const string Email = "email";
}
