using System.Security.Cryptography;

namespace DineFlow.Infrastructure.Restaurant;

public static class RestaurantTableTokenGenerator
{
    private const int TokenByteLength = 32;

    public static string Generate()
    {
        return Convert.ToHexString(RandomNumberGenerator.GetBytes(TokenByteLength))
            .ToLowerInvariant();
    }
}
