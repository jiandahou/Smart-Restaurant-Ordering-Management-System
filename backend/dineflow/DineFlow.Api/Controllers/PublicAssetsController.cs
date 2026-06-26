using Amazon.S3;
using Amazon.S3.Model;
using DineFlow.Api.Options;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Controllers;

[ApiController]
[Route("api/assets")]
public sealed class PublicAssetsController(
    IAmazonS3 s3Client,
    IHostEnvironment hostEnvironment,
    IOptions<AvatarStorageOptions> storageOptions,
    ILogger<PublicAssetsController> logger) : ControllerBase
{
    private static readonly FileExtensionContentTypeProvider ContentTypeProvider = new();
    private static readonly HashSet<string> AllowedSeedMenuExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".svg",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp"
    };

    [HttpGet("seed-menu/{fileName}")]
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> GetSeedMenuImage(string fileName, CancellationToken cancellationToken)
    {
        if (!IsSafeSeedMenuFileName(fileName))
        {
            return NotFound();
        }

        var contentType = ResolveContentType(fileName);
        var options = storageOptions.Value;

        if (IsS3StorageEnabled(options))
        {
            var objectKey = $"seed-menu/{fileName}";

            try
            {
                using var response = await s3Client.GetObjectAsync(options.Bucket, objectKey, cancellationToken);
                await using var responseStream = response.ResponseStream;
                var buffer = new MemoryStream();
                await responseStream.CopyToAsync(buffer, cancellationToken);
                buffer.Position = 0;

                return File(buffer, string.IsNullOrWhiteSpace(response.Headers.ContentType)
                    ? contentType
                    : response.Headers.ContentType);
            }
            catch (AmazonS3Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "Falling back to local seed menu image {FileName} because S3 object could not be read.",
                    fileName);
            }
        }

        var localPath = ResolveLocalSeedMenuImagePath(fileName);

        if (!System.IO.File.Exists(localPath))
        {
            return NotFound();
        }

        return PhysicalFile(localPath, contentType);
    }

    private static bool IsS3StorageEnabled(AvatarStorageOptions options)
    {
        return string.Equals(options.Provider, "S3", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(options.Bucket);
    }

    private static bool IsSafeSeedMenuFileName(string fileName)
    {
        return !string.IsNullOrWhiteSpace(fileName) &&
            string.Equals(fileName, Path.GetFileName(fileName), StringComparison.Ordinal) &&
            AllowedSeedMenuExtensions.Contains(Path.GetExtension(fileName));
    }

    private string ResolveLocalSeedMenuImagePath(string fileName)
    {
        var webRootPath = hostEnvironment is IWebHostEnvironment webHostEnvironment &&
            !string.IsNullOrWhiteSpace(webHostEnvironment.WebRootPath)
                ? webHostEnvironment.WebRootPath
                : Path.Combine(hostEnvironment.ContentRootPath, "wwwroot");

        return Path.Combine(webRootPath, "seed-menu", fileName);
    }

    private static string ResolveContentType(string fileName)
    {
        return ContentTypeProvider.TryGetContentType(fileName, out var contentType)
            ? contentType
            : "application/octet-stream";
    }
}
