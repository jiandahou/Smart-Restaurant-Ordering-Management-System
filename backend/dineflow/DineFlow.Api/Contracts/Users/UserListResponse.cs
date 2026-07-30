namespace DineFlow.Api.Contracts.Users;

public sealed class UserListResponse
{
    public string Id { get; set; } = string.Empty;

    public string? Email { get; set; }

    public string? FullName { get; set; }

    public string? AvatarUrl { get; set; }

    public Guid? RestaurantId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? LastLoginAt { get; set; }

    public List<string> Roles { get; set; } = [];

    /// <summary>
    /// Identity already tracks these; without them an admin cannot tell an unverified account from
    /// a locked-out one, and a user locked out by failed sign-ins is invisible and unrecoverable.
    /// </summary>
    public bool EmailConfirmed { get; set; }

    /// <summary>When set and in the future the account cannot sign in. See <see cref="IsLockedOut"/>.</summary>
    public DateTimeOffset? LockoutEnd { get; set; }

    /// <summary>Evaluated server-side so every client agrees on what "locked" means.</summary>
    public bool IsLockedOut { get; set; }

    /// <summary>
    /// True when the lockout has no practical end date, which is how an account is disabled rather
    /// than deleted — deleting breaks the audit trail that references the user.
    /// </summary>
    public bool IsDisabled { get; set; }

    public int AccessFailedCount { get; set; }

    public bool TwoFactorEnabled { get; set; }
}
