using System.ComponentModel.DataAnnotations;

namespace DineFlow.Api.Contracts.Payments;

public sealed class ConfirmCheckoutSessionRequest
{
    [Required]
    [StringLength(255, MinimumLength = 8)]
    public string SessionId { get; set; } = string.Empty;
}

public sealed class ConfirmCheckoutSessionResponse
{
    public string PaymentStatus { get; set; } = string.Empty;

    public bool Confirmed { get; set; }

    /// <summary>
    /// True when the money arrived for an order the restaurant had already turned away, and has
    /// been sent back.
    /// </summary>
    /// <remarks>
    /// The page that reads this told the customer "your payment and order status are now up to
    /// date" over exactly this case, because a refunded payment counts as confirmed and nothing
    /// else was carried back. The customer had paid, the order did not exist, the refund was
    /// already on its way, and the only screen they were looking at said everything was fine.
    /// </remarks>
    public bool OrderTurnedAway { get; set; }

    public string Message { get; set; } = string.Empty;
}
