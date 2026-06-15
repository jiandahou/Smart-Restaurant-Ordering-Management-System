namespace DineFlow.Api.Contracts.Auth;

public sealed class CreateAvatarUploadUrlResponse
{
    public string Provider { get; set; } = "S3";

    public string UploadUrl { get; set; } = string.Empty;

    public string ObjectKey { get; set; } = string.Empty;

    public string AvatarUrl { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }

    public IReadOnlyDictionary<string, string> Headers { get; set; } = new Dictionary<string, string>();
}
