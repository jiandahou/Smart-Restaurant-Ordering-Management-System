using DineFlow.Infrastructure.Identity;

namespace DineFlow.Infrastructure.Carts;

public class CartParticipant
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CartId { get; set; }

    public string? CustomerId { get; set; }

    public byte[] ParticipantTokenHash { get; set; } = [];

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    public DateTime LastSeenAt { get; set; } = DateTime.UtcNow;

    public Cart? Cart { get; set; }

    public ApplicationUser? Customer { get; set; }
}
