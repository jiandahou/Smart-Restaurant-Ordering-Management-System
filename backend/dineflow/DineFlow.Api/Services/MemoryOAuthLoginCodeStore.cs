using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.AspNetCore.WebUtilities;

namespace DineFlow.Api.Services;

public sealed class MemoryOAuthLoginCodeStore : IOAuthLoginCodeStore
{
    private static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(2);
    private readonly IMemoryCache _cache;

    public MemoryOAuthLoginCodeStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public string CreateCode(string userId)
    {
        var code = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        _cache.Set(BuildCacheKey(code), userId, CodeLifetime);

        return code;
    }

    public bool TryConsumeCode(string code, out string userId)
    {
        userId = string.Empty;

        if (string.IsNullOrWhiteSpace(code))
        {
            return false;
        }

        var cacheKey = BuildCacheKey(code);

        if (!_cache.TryGetValue(cacheKey, out string? cachedUserId) || string.IsNullOrWhiteSpace(cachedUserId))
        {
            return false;
        }

        _cache.Remove(cacheKey);
        userId = cachedUserId;

        return true;
    }

    private static string BuildCacheKey(string code)
    {
        return $"oauth-login-code:{code}";
    }
}
