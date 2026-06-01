namespace DineFlow.Api.Authorization;

public static class AuthorizationPolicies
{
    public const string PlatformOwnerOnly = "PlatformOwnerOnly";
    public const string RestaurantOwnerApi = "RestaurantOwnerApi";
    public const string AdminApi = "AdminApi";
    public const string StaffApi = "StaffApi";
}
