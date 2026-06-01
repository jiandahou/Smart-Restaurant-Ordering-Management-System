namespace DineFlow.Api.Contracts.Payments;

public sealed class CreateTestCheckoutSessionRequest
{
    public string Name { get; set; } = "DineFlow test order";

    public long AmountCents { get; set; }

    public int Quantity { get; set; } = 1;

    public string? Currency { get; set; }
}
