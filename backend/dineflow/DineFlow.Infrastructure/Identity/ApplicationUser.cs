using Microsoft.AspNetCore.Identity;
using RestaurantEntity = DineFlow.Infrastructure.Restaurant.Restaurant;

namespace DineFlow.Infrastructure.Identity;

public class ApplicationUser : IdentityUser
{
    public string? FullName { get; set; }

    public string? AvatarUrl { get; set; }

    public Guid? RestaurantId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public RestaurantEntity? Restaurant { get; set; }
}
