namespace DineFlow.Api.Contracts.Auth;

public sealed class CreateAvatarUploadUrlRequest
{
    public string ContentType { get; set; } = string.Empty;

    public long FileSize { get; set; }
}
