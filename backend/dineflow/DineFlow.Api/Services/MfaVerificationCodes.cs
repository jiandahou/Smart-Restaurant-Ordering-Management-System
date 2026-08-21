namespace DineFlow.Api.Services;

/// <summary>
/// Why a login verification failed, in terms the client can act on.
///
/// <para>
/// Every failure used to read the same to the person at the keyboard, so an expired step (start
/// over) was indistinguishable from a wrong code (try again) and from a locked account (stop and
/// wait) — three situations with three different next actions.
/// </para>
/// </summary>
public static class MfaVerificationCodes
{
    /// <summary>The challenge is gone: there is nothing to retype, sign in again.</summary>
    public const string ChallengeExpired = "mfa_challenge_expired";

    /// <summary>The code was wrong and another attempt is allowed.</summary>
    public const string CodeInvalid = "mfa_code_invalid";

    /// <summary>Further attempts are refused for now, whatever the code says.</summary>
    public const string AccountLocked = "account_locked";


    /// <summary>
    /// A sensitive action was refused because its second factor was missing or wrong. Distinct from
    /// the action itself failing: the person can correct this one without starting over.
    /// </summary>
    public const string SensitiveActionRequired = "mfa_verification_required";
}
