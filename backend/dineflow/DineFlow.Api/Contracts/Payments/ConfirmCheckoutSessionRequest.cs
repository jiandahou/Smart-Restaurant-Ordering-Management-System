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

    public string Message { get; set; } = string.Empty;
}
