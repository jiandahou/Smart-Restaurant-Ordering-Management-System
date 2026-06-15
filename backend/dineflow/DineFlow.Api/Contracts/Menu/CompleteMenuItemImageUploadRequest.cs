namespace DineFlow.Api.Contracts.Menu;

public sealed class CompleteMenuItemImageUploadRequest
{
    public Guid RestaurantId { get; set; }

    public string ObjectKey { get; set; } = string.Empty;
}
