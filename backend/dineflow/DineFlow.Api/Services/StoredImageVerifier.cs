using Amazon.S3;
using Amazon.S3.Model;

namespace DineFlow.Api.Services;

/// <summary>
/// Checks an object that was uploaded straight to the bucket.
///
/// <para>
/// A presigned upload never passes through the API, so the confirm step is the first and only
/// chance to see what was actually stored. Both the content type recorded on the object and the key
/// it was stored under came from the uploader, and neither is evidence of anything.
/// </para>
/// </summary>
public sealed class StoredImageVerifier(IAmazonS3 s3Client, ILogger<StoredImageVerifier> logger)
{
    /// <summary>
    /// True when the stored object really is an image of the type it claims. Only the first bytes
    /// are fetched, so this costs the same whether the object is 4KB or the size limit.
    /// </summary>
    public async Task<bool> IsDeclaredImageAsync(
        string bucket,
        string objectKey,
        string? declaredContentType,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await s3Client.GetObjectAsync(
                new GetObjectRequest
                {
                    BucketName = bucket,
                    Key = objectKey,
                    ByteRange = new ByteRange(0, ImageContentSignature.BytesNeeded - 1),
                },
                cancellationToken);

            var header = await ImageContentSignature.ReadHeaderAsync(response.ResponseStream, cancellationToken);

            return ImageContentSignature.Matches(header, declaredContentType);
        }
        catch (AmazonS3Exception ex)
        {
            // Unreadable is not provably an image, so it is refused like any other mismatch.
            logger.LogWarning(ex, "Could not read {ObjectKey} to verify it is an image.", objectKey);

            return false;
        }
    }

    /// <summary>
    /// Removes an object that failed verification. Best effort: the upload was already rejected, and
    /// leaving a stray object behind is a tidiness problem rather than a correctness one.
    /// </summary>
    public async Task DeleteAsync(string bucket, string objectKey, CancellationToken cancellationToken)
    {
        try
        {
            await s3Client.DeleteObjectAsync(bucket, objectKey, cancellationToken);
        }
        catch (AmazonS3Exception ex)
        {
            logger.LogWarning(ex, "Could not delete rejected upload {ObjectKey}.", objectKey);
        }
    }
}
