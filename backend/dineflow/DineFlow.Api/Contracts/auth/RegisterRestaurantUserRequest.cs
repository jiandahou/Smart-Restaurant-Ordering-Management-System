namespace DineFlow.Api.Contracts.Auth;

public class RegisterRestaurantUserRequest : RegisterRequest
{
    public Guid? RestaurantId { get; set; }
}
