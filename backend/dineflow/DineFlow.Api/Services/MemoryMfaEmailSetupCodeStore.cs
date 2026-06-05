using Microsoft.Extensions.Caching.Memory;

namespace DineFlow.Api.Services;

public sealed class MemoryMfaEmailSetupCodeStore : IMfaEmailSetupCodeStore
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    private readonly IMemoryCache _cache;

    public MemoryMfaEmailSetupCodeStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public void Store(string userId, string code)
    {
        _cache.Set(BuildCacheKey(userId), code, CodeLifetime);
    }

    public bool TryConsume(string userId, string code)
    {
        if (string.IsNullOrWhiteSpace(userId) || string.IsNullOrWhiteSpace(code))
        {
            return false;
        }

        var cacheKey = BuildCacheKey(userId);

        if (!_cache.TryGetValue(cacheKey, out string? cachedCode) ||
            !string.Equals(cachedCode, code, StringComparison.Ordinal))
        {
            return false;
        }

        _cache.Remove(cacheKey);

        return true;
    }

    private static string BuildCacheKey(string userId)
    {
        return $"mfa-email-setup-code:{userId}";
    }
}
