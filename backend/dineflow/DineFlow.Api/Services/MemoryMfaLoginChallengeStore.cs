using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Caching.Memory;

namespace DineFlow.Api.Services;

public sealed class MemoryMfaLoginChallengeStore : IMfaLoginChallengeStore
{
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);
    private readonly IMemoryCache _cache;

    public MemoryMfaLoginChallengeStore(IMemoryCache cache)
    {
        _cache = cache;
    }

    public string Create(string userId, IReadOnlyCollection<string> methods, string? emailCode)
    {
        var challengeId = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var challenge = new MfaLoginChallenge(userId, methods.ToArray(), emailCode);

        _cache.Set(BuildCacheKey(challengeId), challenge, ChallengeLifetime);

        return challengeId;
    }

    public bool TryConsume(string challengeId, out MfaLoginChallenge challenge)
    {
        if (!TryGet(challengeId, out challenge))
        {
            return false;
        }

        _cache.Remove(BuildCacheKey(challengeId));

        return true;
    }

    public bool TryGet(string challengeId, out MfaLoginChallenge challenge)
    {
        challenge = new MfaLoginChallenge(string.Empty, Array.Empty<string>(), null);

        if (string.IsNullOrWhiteSpace(challengeId))
        {
            return false;
        }

        var cacheKey = BuildCacheKey(challengeId);

        if (!_cache.TryGetValue(cacheKey, out MfaLoginChallenge? cachedChallenge) ||
            cachedChallenge is null ||
            string.IsNullOrWhiteSpace(cachedChallenge.UserId))
        {
            return false;
        }

        challenge = cachedChallenge;

        return true;
    }

    private static string BuildCacheKey(string challengeId)
    {
        return $"mfa-login-challenge:{challengeId}";
    }
}
