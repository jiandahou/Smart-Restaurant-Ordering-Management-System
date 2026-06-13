namespace DineFlow.Api.Contracts.Menu;

public sealed class CompleteMenuItemImageUploadResponse
{
    public string ObjectKey { get; set; } = string.Empty;

    public string ImageUrl { get; set; } = string.Empty;
}
