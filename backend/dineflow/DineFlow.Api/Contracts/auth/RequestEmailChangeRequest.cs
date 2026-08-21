namespace DineFlow.Api.Contracts.Auth;

public class RequestEmailChangeRequest
{
    public string NewEmail { get; set; } = string.Empty;

    public string CurrentPassword { get; set; } = string.Empty;

    /// <summary>
    /// Second factor, when the account requires one for sensitive actions. Changing the address is
    /// how an account is taken over: every reset link and email code follows it to the new inbox.
    /// </summary>
    public MfaVerificationRequest? Verification { get; set; }
}
