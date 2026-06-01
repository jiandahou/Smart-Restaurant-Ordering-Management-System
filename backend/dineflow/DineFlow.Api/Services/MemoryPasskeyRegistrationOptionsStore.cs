using Fido2NetLib;
using Microsoft.Extensions.Caching.Memory;

namespace DineFlow.Api.Services;

public sealed class MemoryPasskeyRegistrationOptionsStore : IPasskeyRegistrationOptionsStore
{
    private static readonly TimeSpan OptionsLifetime = TimeSpan.FromMinutes(5);
    private readonly IMemoryCache _cache;

    public MemoryPasskeyRegistrationOptionsStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public void Store(string userId, CredentialCreateOptions options)
    {
        _cache.Set(BuildCacheKey(userId), options, OptionsLifetime);
    }

    public bool TryConsume(string userId, out CredentialCreateOptions options)
    {
        options = null!;
        var cacheKey = BuildCacheKey(userId);

        if (!_cache.TryGetValue(cacheKey, out CredentialCreateOptions? cachedOptions) || cachedOptions is null)
        {
            return false;
        }

        _cache.Remove(cacheKey);
        options = cachedOptions;

        return true;
    }

    private static string BuildCacheKey(string userId)
    {
        return $"passkey-registration-options:{userId}";
    }
}
