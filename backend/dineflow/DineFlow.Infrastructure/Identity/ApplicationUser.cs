using Microsoft.AspNetCore.Identity;

namespace DineFlow.Infrastructure.Identity;

public class ApplicationUser : IdentityUser
{
    public string? FullName { get; set; }

    public string? AvatarUrl { get; set; }

    public Guid? RestaurantId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }
}
