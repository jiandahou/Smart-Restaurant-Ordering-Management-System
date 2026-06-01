namespace DineFlow.Api.Contracts.Users;

public class UpdateUserRequest
{
    public string? Email { get; set; }

    public string? FullName { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? Role { get; set; }

    public string? Password { get; set; }
}
