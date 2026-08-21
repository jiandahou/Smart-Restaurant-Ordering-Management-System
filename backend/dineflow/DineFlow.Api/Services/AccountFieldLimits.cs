using Microsoft.AspNetCore.Identity;

namespace DineFlow.Api.Services;

/// <summary>
/// Bounds for the free-text fields on an account. Kept here rather than as attributes on each
/// contract so that every path that accepts a name — customer registration, staff creation, a
/// profile edit — agrees on what is acceptable.
/// </summary>
public static class AccountFieldLimits
{
    /// <summary>
    /// Long enough for a full legal name with titles and multiple given names; short enough that
    /// the value stays displayable in an order ticket and a receipt.
    /// </summary>
    public const int FullNameMaxLength = 100;

    /// <summary>
    /// Hashing cost grows with the input, so an unbounded password is work an anonymous caller can
    /// ask for at will. Long enough that no real passphrase is affected — and rejected outright
    /// rather than truncated, because silently hashing a prefix would let a shorter password open
    /// the account.
    /// </summary>
    public const int PasswordMaxLength = 128;

    /// <summary>The name as it will be stored: surrounding whitespace is not part of a name.</summary>
    public static string NormalizeFullName(string? value) => value?.Trim() ?? string.Empty;

    /// <summary>Why this name is unacceptable, or null when it is fine.</summary>
    public static string? DescribeFullNameProblem(string? value)
    {
        var normalized = NormalizeFullName(value);

        if (normalized.Length == 0)
        {
            // A name of three spaces used to pass this check and create a real account.
            return "Full name is required.";
        }

        return normalized.Length > FullNameMaxLength
            ? $"Full name must be {FullNameMaxLength} characters or fewer."
            : null;
    }
}

/// <summary>
/// Identity has a minimum password length and no maximum. Written as a validator rather than a
/// check at the registration endpoint because every path that sets a password — registering,
/// resetting, changing, adding one to a social account — runs validators, and each one otherwise
/// hashes whatever it is given.
/// </summary>
public sealed class MaximumLengthPasswordValidator<TUser> : IPasswordValidator<TUser>
    where TUser : class
{
    public Task<IdentityResult> ValidateAsync(UserManager<TUser> manager, TUser user, string? password) =>
        Task.FromResult(password is not null && password.Length > AccountFieldLimits.PasswordMaxLength
            ? IdentityResult.Failed(new IdentityError
            {
                Code = "PasswordTooLong",
                Description = $"Password must be {AccountFieldLimits.PasswordMaxLength} characters or fewer.",
            })
            : IdentityResult.Success);
}
