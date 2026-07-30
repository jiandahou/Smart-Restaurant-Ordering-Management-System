using System.Text.RegularExpressions;
using DineFlow.Infrastructure.Restaurant;
using Stripe;

namespace DineFlow.Api.Services;

public static partial class StripeConnectPrefillBuilder
{
    public static AccountBusinessProfileOptions Build(
        Restaurant restaurant,
        string? supportEmail)
    {
        ArgumentNullException.ThrowIfNull(restaurant);

        return new AccountBusinessProfileOptions
        {
            Name = restaurant.Name.Trim(),
            ProductDescription =
                $"{restaurant.Name.Trim()} provides restaurant dining, takeaway, and online ordering services.",
            SupportEmail = NormalizeOptional(supportEmail),
            SupportPhone = NormalizeOptional(restaurant.Phone),
            SupportAddress = BuildSupportAddress(restaurant)
        };
    }

    public static AddressOptions? BuildSupportAddress(Restaurant restaurant)
    {
        ArgumentNullException.ThrowIfNull(restaurant);

        var address = NormalizeOptional(restaurant.Address);
        if (address is null)
        {
            return null;
        }

        var country = NormalizeOptional(restaurant.CountryCode)?.ToUpperInvariant();
        var result = new AddressOptions
        {
            Country = country,
            Line1 = address
        };

        if (!string.Equals(country, "AU", StringComparison.Ordinal))
        {
            return result;
        }

        var segments = address.Split(
            ',',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments.Length < 2)
        {
            return result;
        }

        var localityMatch = AustralianLocalityPattern().Match(segments[^1]);
        if (!localityMatch.Success)
        {
            return result;
        }

        result.Line1 = string.Join(", ", segments[..^1]);
        result.City = localityMatch.Groups["city"].Value;
        result.State = localityMatch.Groups["state"].Value;
        result.PostalCode = NormalizeOptional(localityMatch.Groups["postal"].Value);
        return result;
    }

    private static string? NormalizeOptional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    [GeneratedRegex(
        @"^(?<city>.+?)\s+(?<state>ACT|NSW|NT|QLD|SA|TAS|VIC|WA)(?:\s+(?<postal>\d{4}))?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AustralianLocalityPattern();
}
