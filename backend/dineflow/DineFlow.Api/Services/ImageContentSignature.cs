namespace DineFlow.Api.Services;

/// <summary>
/// What an uploaded file actually is, read from its first bytes.
///
/// <para>
/// The declared content type and the file extension both come from whoever is uploading, so neither
/// says anything about the contents: a script renamed to <c>.jpg</c> and sent as
/// <c>image/jpeg</c> passed every check we had and was stored and served as an image. The leading
/// bytes of a real image are not something the uploader can fake without supplying a real image.
/// </para>
/// </summary>
public static class ImageContentSignature
{
    /// <summary>Enough for the longest signature we look for, with room to spare.</summary>
    public const int BytesNeeded = 16;

    /// <summary>The media type these bytes really are, or null when they are not an image we accept.</summary>
    public static string? Detect(ReadOnlySpan<byte> header)
    {
        if (IsJpeg(header))
        {
            return "image/jpeg";
        }

        if (IsPng(header))
        {
            return "image/png";
        }

        return IsWebp(header) ? "image/webp" : null;
    }

    /// <summary>
    /// True when the bytes are an image of exactly the type that was claimed. A mismatch is as
    /// suspect as a file that is not an image at all — a PNG announced as a JPEG is either a broken
    /// client or someone probing what the checks let through.
    /// </summary>
    public static bool Matches(ReadOnlySpan<byte> header, string? declaredContentType)
    {
        var actual = Detect(header);

        return actual is not null
            && string.Equals(actual, declaredContentType?.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Reads the leading bytes of a stream, without assuming it can be rewound.</summary>
    public static async Task<byte[]> ReadHeaderAsync(Stream stream, CancellationToken cancellationToken)
    {
        var buffer = new byte[BytesNeeded];
        var read = await stream.ReadAtLeastAsync(buffer, BytesNeeded, throwOnEndOfStream: false, cancellationToken);

        return read == BytesNeeded ? buffer : buffer[..read];
    }

    /// <summary>Start of Image, then the first marker. Every JPEG begins with these three bytes.</summary>
    private static bool IsJpeg(ReadOnlySpan<byte> header) =>
        header.Length >= 3 && header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF;

    private static ReadOnlySpan<byte> PngMagic => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    private static bool IsPng(ReadOnlySpan<byte> header) =>
        header.Length >= 8 && header[..8].SequenceEqual(PngMagic);

    /// <summary>A RIFF container whose form type is WEBP; the four bytes between are the length.</summary>
    private static bool IsWebp(ReadOnlySpan<byte> header) =>
        header.Length >= 12
            && header[..4].SequenceEqual("RIFF"u8)
            && header[8..12].SequenceEqual("WEBP"u8);
}
