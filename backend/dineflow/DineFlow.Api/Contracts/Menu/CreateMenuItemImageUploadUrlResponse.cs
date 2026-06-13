namespace DineFlow.Api.Contracts.Menu;

public sealed class CreateMenuItemImageUploadUrlResponse
{
    public string Provider { get; set; } = "S3";

    public string UploadUrl { get; set; } = string.Empty;

    public string ObjectKey { get; set; } = string.Empty;

    public string ImageUrl { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }

    public IReadOnlyDictionary<string, string> Headers { get; set; } = new Dictionary<string, string>();
}
