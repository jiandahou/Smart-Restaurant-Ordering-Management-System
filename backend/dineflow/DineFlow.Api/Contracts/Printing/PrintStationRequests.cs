namespace DineFlow.Api.Contracts.Printing;

public sealed record UpsertPrintStationRequest(
    string StationKey,
    string? Name,
    bool AutoPrintEnabled,
    Guid? RestaurantId,
    string? ClientInstanceId,
    string? QzStatus,
    string? PrinterStatus,
    string? PrinterName,
    string? ConnectionType,
    string? QzVersion,
    string? LastError);

public sealed record ClaimPrintJobsRequest(
    string StationKey,
    string ClientInstanceId,
    Guid? RestaurantId,
    int MaxJobs = 2);

public sealed record UpdatePrintJobStatusRequest(
    Guid LeaseToken,
    string Status,
    string? Detail,
    string? Error);

public sealed record ReprintOrderRequest(
    string StationKey,
    Guid? RestaurantId,
    string? Reason);

public sealed record RetryPrintJobRequest(string? Reason);
