namespace DineFlow.Infrastructure.Payments;

public class TestPaymentOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string? UserId { get; set; }

    public string Name { get; set; } = string.Empty;

    public long AmountCents { get; set; }

    public int Quantity { get; set; } = 1;

    public string Currency { get; set; } = "aud";

    public string Status { get; set; } = TestPaymentStatuses.Pending;

    public string? StripeCheckoutSessionId { get; set; }

    public string? StripePaymentIntentId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }
}

public static class TestPaymentStatuses
{
    public const string Pending = "Pending";
    public const string Paid = "Paid";
    public const string Failed = "Failed";
    public const string Expired = "Expired";
}
