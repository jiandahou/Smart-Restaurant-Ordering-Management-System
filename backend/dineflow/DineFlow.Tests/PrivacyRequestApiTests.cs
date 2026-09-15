using System.Net;
using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The whole path a privacy request takes, over HTTP.
/// </summary>
/// <remarks>
/// Two endpoints existed — file one, list your own — and nothing else. No listing for whoever had to
/// answer, no way to move a request along, and no screen reaching any of it. A person could ask for
/// their information to be deleted and the request would sit in a table with the thirty-day clock
/// running against a queue nobody could see.
/// </remarks>
public sealed class PrivacyRequestApiTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    private HttpClient _customer = null!;
    private HttpClient _owner = null!;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        _customer = await _api.SignInAsAsync("privacy-customer@dineflow.test", ApplicationRoles.Customer);
        _owner = await _api.SignInAsAsync(DineFlowApiFactory.OwnerEmail, ApplicationRoles.PlatformOwner);
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    private Task<HttpResponseMessage> FileAsync(string type = "Deletion", string? details = null) =>
        _customer.PostAsJsonAsync("/api/privacy/requests", new
        {
            requestType = type,
            details = details ?? "Please delete the account and order history held about me.",
        });

    private async Task<Guid> FileAndFindAsync()
    {
        (await FileAsync()).EnsureSuccessStatusCode();

        var mine = await _customer.GetFromJsonAsync<List<Record>>("/api/privacy/requests/mine");
        return mine!.Single().Id;
    }

    // ---- what a customer can do ----------------------------------------------------------------

    [RequiresPostgresFact]
    public async Task LetsSomeoneAskAboutTheirOwnInformationAndSeeIt()
    {
        (await FileAsync("Access", "Please send me a copy of what is held about me.")).EnsureSuccessStatusCode();

        var mine = await _customer.GetFromJsonAsync<List<Record>>("/api/privacy/requests/mine");

        var only = Assert.Single(mine!);
        Assert.Equal("Access", only.RequestType);
        Assert.Equal(PrivacyRequestWorkflow.Received, only.Status);
    }

    [RequiresPostgresFact]
    public async Task RefusesARequestNobodyCouldAct()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await FileAsync(details: "help")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await FileAsync("Everything")).StatusCode);
    }

    /// <summary>One person's request is not another's to read.</summary>
    [RequiresPostgresFact]
    public async Task ShowsSomeoneOnlyTheirOwnRequests()
    {
        await FileAsync();
        var somebodyElse = await _api.SignInAsAsync("privacy-other@dineflow.test", ApplicationRoles.Customer);

        var theirs = await somebodyElse.GetFromJsonAsync<List<Record>>("/api/privacy/requests/mine");

        Assert.Empty(theirs!);
    }

    // ---- who may answer them -------------------------------------------------------------------

    [RequiresPostgresFact]
    public async Task RefusesAnyoneButThePlatformOwnerTheQueue()
    {
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await _api.CreateClient().GetAsync("/api/privacy/requests")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await _customer.GetAsync("/api/privacy/requests")).StatusCode);

        var restaurantOwner = await _api.SignInAsAsync(
            "privacy-restaurant-owner@dineflow.test", ApplicationRoles.RestaurantOwner);
        Assert.Equal(HttpStatusCode.Forbidden, (await restaurantOwner.GetAsync("/api/privacy/requests")).StatusCode);
    }

    /// <summary>The queue exists at all, which it did not before.</summary>
    [RequiresPostgresFact]
    public async Task ShowsThePlatformOwnerTheQueueWithTheClockOnIt()
    {
        await FileAsync();

        var queue = await _owner.GetFromJsonAsync<List<AdminRecord>>("/api/privacy/requests");

        var only = Assert.Single(queue!);
        Assert.Equal("privacy-customer@dineflow.test", only.RequesterEmail);
        Assert.False(only.IsOverdue);
        Assert.Equal(30, only.DaysRemaining);
    }

    // ---- answering one -------------------------------------------------------------------------

    [RequiresPostgresFact]
    public async Task MovesARequestAlongAndClosesIt()
    {
        var id = await FileAndFindAsync();

        (await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "InProgress", note = "Locating the records." })).EnsureSuccessStatusCode();
        (await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "Completed", note = "Account and order history removed." })).EnsureSuccessStatusCode();

        // The customer sees it without having to ask again.
        var mine = await _customer.GetFromJsonAsync<List<Record>>("/api/privacy/requests/mine");
        Assert.Equal(PrivacyRequestWorkflow.Completed, mine!.Single().Status);
        Assert.NotNull(mine.Single().CompletedAt);
    }

    /// <summary>
    /// Declining someone's request about their own information is the one move that must carry a
    /// reason — it is what the person is owed, and the first thing an investigation asks for.
    /// </summary>
    [RequiresPostgresFact]
    public async Task RefusesToDeclineWithoutSayingWhy()
    {
        var id = await FileAndFindAsync();

        var response = await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "Declined" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await _api.UseDbAsync(async context =>
            Assert.Equal(
                PrivacyRequestWorkflow.Received,
                (await context.PrivacyRequests.AsNoTracking().SingleAsync(item => item.Id == id)).Status));
    }

    [RequiresPostgresFact]
    public async Task RefusesToReopenAnAnsweredRequest()
    {
        var id = await FileAndFindAsync();
        (await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "Completed" })).EnsureSuccessStatusCode();

        var response = await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "InProgress" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    /// <summary>Answering leaves a record with a name on it.</summary>
    [RequiresPostgresFact]
    public async Task WritesAnAuditRecordForTheAnswer()
    {
        var id = await FileAndFindAsync();
        (await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "Declined", note = "Records are required for seven years under tax law." }))
            .EnsureSuccessStatusCode();

        await _api.UseDbAsync(async context =>
        {
            var audits = await context.AuditLogs.AsNoTracking()
                .Where(log => log.EntityId == id.ToString())
                .ToListAsync();

            Assert.Contains(audits, log => log.Action == "Privacy.RequestStatusChanged");
            Assert.Contains(audits, log => (log.AfterJson ?? string.Empty).Contains("seven years"));
        });
    }

    /// <summary>Open-only is what somebody working the queue actually wants to see.</summary>
    [RequiresPostgresFact]
    public async Task LeavesAnsweredRequestsOutOfTheOpenQueue()
    {
        var id = await FileAndFindAsync();
        (await _owner.PostAsJsonAsync($"/api/privacy/requests/{id}/status",
            new { status = "Completed" })).EnsureSuccessStatusCode();

        Assert.Empty((await _owner.GetFromJsonAsync<List<AdminRecord>>("/api/privacy/requests?openOnly=true"))!);
        Assert.Single((await _owner.GetFromJsonAsync<List<AdminRecord>>("/api/privacy/requests"))!);
    }

    private sealed record Record(Guid Id, string RequestType, string Status, DateTime? CompletedAt);

    private sealed record AdminRecord(
        Guid Id,
        string RequestType,
        string Status,
        string? RequesterEmail,
        int? DaysRemaining,
        bool IsOverdue);
}
