namespace DineFlow.Api.Contracts.Users;

public sealed class UpdateUserStatusRequest
{
    /// <summary>
    /// True parks the Identity lockout far in the future, which disables sign-in without deleting
    /// the account and the audit history attached to it.
    /// </summary>
    public bool IsDisabled { get; set; }
}
