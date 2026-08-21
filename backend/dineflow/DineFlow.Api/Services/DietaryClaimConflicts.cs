namespace DineFlow.Api.Services;

/// <summary>
/// Finds dietary claims that the item's own allergen text contradicts.
///
/// <para>
/// An item could be saved marked gluten free while its allergen list read "wheat, gluten", or
/// marked vegan while listing milk and eggs. Nothing rejected it, so the contradiction reached the
/// customer, the receipt and the dietary filters — a coeliac filtering for gluten free was shown an
/// item that declares gluten on its own label.
/// </para>
///
/// <para>
/// These are reported for confirmation rather than refused. The match is by keyword, and a keyword
/// cannot tell "contains wheat" from "no wheat added": refusing outright would block legitimate
/// wording, while asking the person to look again costs one click and leaves a record of who said
/// it was correct.
/// </para>
/// </summary>
public static class DietaryClaimConflicts
{
    /// <summary>What each claim cannot coexist with, in the languages the menus are written in.</summary>
    private static readonly (string Claim, string[] Keywords)[] Rules =
    [
        ("gluten free", ["gluten", "wheat", "barley", "rye", "spelt", "semolina",
            "麸质", "面筋", "小麦", "大麦", "黑麦", "麦"]),
        ("vegan", ["milk", "dairy", "cream", "butter", "cheese", "egg", "honey", "gelatin", "gelatine",
            "fish", "shellfish", "prawn", "shrimp", "crab", "meat", "beef", "pork", "chicken", "lamb",
            "牛奶", "乳", "奶油", "黄油", "芝士", "鸡蛋", "蛋", "蜂蜜", "明胶", "鱼", "虾", "蟹",
            "肉", "牛", "猪", "鸡", "羊"]),
        ("vegetarian", ["gelatin", "gelatine", "fish", "shellfish", "prawn", "shrimp", "crab",
            "meat", "beef", "pork", "chicken", "lamb", "anchovy",
            "明胶", "鱼", "虾", "蟹", "肉", "牛", "猪", "鸡", "羊"]),
        ("halal", ["pork", "bacon", "ham", "lard", "alcohol", "wine", "beer", "rum",
            "猪", "培根", "火腿", "猪油", "酒", "葡萄酒", "啤酒"]),
    ];

    /// <summary>
    /// One readable line per contradiction, empty when the claims and the allergen text agree.
    /// </summary>
    public static IReadOnlyList<string> Find(
        bool isGlutenFree,
        bool isVegan,
        bool isVegetarian,
        bool isHalal,
        string? allergens,
        string? mayContainAllergens)
    {
        var claims = new[]
        {
            ("gluten free", isGlutenFree),
            ("vegan", isVegan),
            ("vegetarian", isVegetarian),
            ("halal", isHalal),
        };

        var conflicts = new List<string>();

        foreach (var (claim, isClaimed) in claims)
        {
            if (!isClaimed)
            {
                continue;
            }

            var keywords = Rules.First(rule => rule.Claim == claim).Keywords;

            foreach (var (field, text) in new[] { ("allergens", allergens), ("may contain", mayContainAllergens) })
            {
                var matched = MatchedKeyword(text, keywords);

                if (matched is not null)
                {
                    conflicts.Add($"Marked {claim}, but the {field} text mentions \"{matched}\".");
                }
            }
        }

        return conflicts;
    }

    private static string? MatchedKeyword(string? text, string[] keywords) =>
        string.IsNullOrWhiteSpace(text)
            ? null
            : keywords.FirstOrDefault(keyword => text.Contains(keyword, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Vegan implies vegetarian — there is no dish that is one and not the other. Corrected on the
    /// way in rather than reported, because it is not a judgement call and an item that claimed
    /// vegan without vegetarian was invisible to the vegetarian filter.
    /// </summary>
    public static bool ResolveVegetarian(bool isVegan, bool isVegetarian) => isVegan || isVegetarian;
}
