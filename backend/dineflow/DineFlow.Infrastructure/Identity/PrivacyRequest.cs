namespace DineFlow.Infrastructure.Identity;

public class PrivacyRequest
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = string.Empty;
    public string RequestType { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
    public string Status { get; set; } = "Received";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public ApplicationUser? User { get; set; }
}
