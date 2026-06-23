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

    public List<string> Roles { get; set; } = [];
}
