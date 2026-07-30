namespace DineFlow.Api.Contracts.Auth;

public class RegisterRestaurantUserRequest : RegisterRequest
{
    public Guid? RestaurantId { get; set; }

    /// <summary>
    /// Creates the account without an administrator-known password and emails the user a
    /// short-lived link to choose their own password.
    /// </summary>
    public bool SendPasswordSetupEmail { get; set; }
}
