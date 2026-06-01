namespace DineFlow.Api.Contracts.Payments;

public sealed class TestPaymentOrderResponse
{
    public Guid Id { get; set; }

    public string? UserId { get; set; }

    public string? UserEmail { get; set; }

    public string Name { get; set; } = string.Empty;

    public long AmountCents { get; set; }

    public int Quantity { get; set; }

    public long TotalCents { get; set; }

    public string Currency { get; set; } = string.Empty;

    public string Status { get; set; } = string.Empty;

    public string? StripeCheckoutSessionId { get; set; }

    public string? StripePaymentIntentId { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public DateTime? PaidAt { get; set; }
}
