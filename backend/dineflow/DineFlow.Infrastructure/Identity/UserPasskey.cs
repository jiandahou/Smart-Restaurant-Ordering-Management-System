namespace DineFlow.Infrastructure.Identity;

public class UserPasskey
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string UserId { get; set; } = string.Empty;

    public ApplicationUser User { get; set; } = null!;

    public byte[] CredentialId { get; set; } = [];

    public byte[] PublicKey { get; set; } = [];

    public byte[] UserHandle { get; set; } = [];

    public long SignCount { get; set; }

    public string? DeviceName { get; set; }

    public string? CredentialType { get; set; }

    public string? Transports { get; set; }

    public Guid? AaGuid { get; set; }

    public bool IsBackedUp { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastUsedAt { get; set; }
}
