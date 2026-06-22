using System.ComponentModel.DataAnnotations;

namespace DineFlow.Api.Contracts.Common;

public abstract class PagedRequest
{
    [Range(1, int.MaxValue)]
    public int Page { get; set; } = 1;

    [Range(1, 100)]
    public int PageSize { get; set; } = 20;

    [MaxLength(200)]
    public string? Search { get; set; }

    public string? SortBy { get; set; }

    [RegularExpression("^(?i:asc|desc)$", ErrorMessage = "SortDirection must be 'asc' or 'desc'.")]
    public string SortDirection { get; set; } = "desc";

    public bool IsDescending => SortDirection.Equals("desc", StringComparison.OrdinalIgnoreCase);
}
