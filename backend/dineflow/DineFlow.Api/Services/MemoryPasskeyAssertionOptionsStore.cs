using Fido2NetLib;
using Microsoft.Extensions.Caching.Memory;

namespace DineFlow.Api.Services;

public sealed class MemoryPasskeyAssertionOptionsStore : IPasskeyAssertionOptionsStore
{
    private static readonly TimeSpan OptionsLifetime = TimeSpan.FromMinutes(5);
    private readonly IMemoryCache _cache;

    public MemoryPasskeyAssertionOptionsStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public void Store(string challenge, AssertionOptions options)
    {
        _cache.Set(BuildCacheKey(challenge), options, OptionsLifetime);
    }

    public bool TryConsume(string challenge, out AssertionOptions options)
    {
        options = null!;
        var cacheKey = BuildCacheKey(challenge);

        if (string.IsNullOrWhiteSpace(challenge) ||
            !_cache.TryGetValue(cacheKey, out AssertionOptions? cachedOptions) ||
            cachedOptions is null)
        {
            return false;
        }

        _cache.Remove(cacheKey);
        options = cachedOptions;

        return true;
    }

    private static string BuildCacheKey(string challenge)
    {
        return $"passkey-assertion-options:{challenge}";
    }
}
