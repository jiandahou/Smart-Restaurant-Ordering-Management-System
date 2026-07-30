using DineFlow.Api.Contracts.Common;

namespace DineFlow.Api.Contracts.Users;

public sealed class UserListRequest : PagedRequest
{
    public string? Role { get; set; }

    public Guid? RestaurantId { get; set; }

    public string? Scope { get; set; }

    /// <summary>
    /// staff | customers | all. Customers vastly outnumber staff on a live venue, so the directory
    /// needs to narrow to the people who are actually administered here. Filtering client-side is
    /// not an option — it would make the paging totals lie.
    /// </summary>
    public string? Audience { get; set; }

    /// <summary>all | active | disabled | locked | unverified | mfa.</summary>
    public string? Status { get; set; }
}
