namespace DineFlow.Api.Options;

public sealed class AvatarStorageOptions
{
    public const string SectionName = "AvatarStorage";

    public string Provider { get; set; } = "Local";

    public string Bucket { get; set; } = string.Empty;

    public string Region { get; set; } = "ap-southeast-2";

    public string? ServiceUrl { get; set; }

    public string? UploadBaseUrl { get; set; }

    public string? PublicBaseUrl { get; set; }

    public bool ForcePathStyle { get; set; }

    public int UploadUrlExpirationMinutes { get; set; } = 10;
}
