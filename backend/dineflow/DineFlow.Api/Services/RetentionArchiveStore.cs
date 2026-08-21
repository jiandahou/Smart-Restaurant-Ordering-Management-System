namespace DineFlow.Api.Services;

/// <summary>
/// Where retention archives are written and read back from.
/// </summary>
/// <remarks>
/// An interface for one reason: the guard that refuses to delete when an archive does not match its
/// manifest is the single control standing between retention and data loss, and with a bare
/// <c>File.WriteAllText</c> there was no way to reach it in a test. A control nobody has seen fail
/// is a control nobody knows works.
/// </remarks>
public interface IRetentionArchiveStore
{
    Task WriteAsync(string directory, string fileName, string content, CancellationToken cancellationToken);

    Task<string> ReadAsync(string directory, string fileName, CancellationToken cancellationToken);
}

/// <summary>
/// The real one: a directory the deployment mounts.
/// </summary>
/// <remarks>
/// A path rather than an object-store client on purpose. The encrypted, lifecycle-managed bucket is
/// mounted or synced here by the deployment, so its credentials never enter this process — the same
/// reasoning that keeps the deletion role out of the web runtime.
/// </remarks>
public sealed class FileSystemRetentionArchiveStore : IRetentionArchiveStore
{
    public async Task WriteAsync(string directory, string fileName, string content, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, fileName), content, cancellationToken);
    }

    public Task<string> ReadAsync(string directory, string fileName, CancellationToken cancellationToken) =>
        File.ReadAllTextAsync(Path.Combine(directory, fileName), cancellationToken);
}
