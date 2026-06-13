namespace DineFlow.Api.Contracts.Menu;

public sealed class CreateMenuItemImageUploadUrlRequest
{
    public Guid RestaurantId { get; set; }

    public string ContentType { get; set; } = string.Empty;

    public long FileSize { get; set; }
}
