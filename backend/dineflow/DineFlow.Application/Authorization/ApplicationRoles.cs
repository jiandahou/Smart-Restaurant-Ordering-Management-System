namespace DineFlow.Application.Authorization;

public static class ApplicationRoles
{
    public const string PlatformOwner = "PlatformOwner";
    public const string RestaurantOwner = "RestaurantOwner";
    public const string Admin = "Admin";
    public const string Staff = "Staff";
    public const string Customer = "Customer";

    public static readonly IReadOnlyDictionary<string, int> RoleRanks = new Dictionary<string, int>
    {
        [PlatformOwner] = 4,
        [RestaurantOwner] = 3,
        [Admin] = 2,
        [Staff] = 1,
        [Customer] = 0
    };

    public static readonly IReadOnlySet<string> ManagedRoles = new HashSet<string>
    {
        RestaurantOwner,
        Admin,
        Staff,
        Customer
    };

    public static readonly IReadOnlyList<string> All =
    [
        PlatformOwner,
        RestaurantOwner,
        Admin,
        Staff,
        Customer
    ];
}
