using System.Net.Http.Json;
using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Orders;
using DineFlow.Infrastructure.Payments;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Infrastructure.Printing;
using DineFlow.Tests.Infrastructure;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// The print task list and the "N failed" badge have to describe the same jobs.
/// </summary>
/// <remarks>
/// The badge was counted over every job in the restaurant while the list was only the most recently
/// updated thirty. A ticket that failed days ago is pushed out of that window by everything that
/// printed fine since, so the screen said "1 failed" and showed nothing failed — and the one job
/// somebody had been sent to deal with was the one job they could not reach.
/// </remarks>
public sealed class PrintJobAttentionListTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();
    private readonly Guid _restaurantId = Guid.NewGuid();
    private HttpClient _staff = null!;

    private const int RecentJobs = 40;

    public async Task InitializeAsync()
    {
        await _api.InitializeAsync();
        if (_api.ConnectionString is null)
        {
            return;
        }

        await _api.UseDbAsync(async context =>
        {
            context.Restaurants.Add(FrontCounterScenario.Restaurant(_restaurantId, "Printing Kitchen"));

            // One failure, days old, then far more recent successes than the page can hold.
            Add(context, "TICKET-FAILED", PrintJobState.DeadLetter, DateTime.UtcNow.AddDays(-4));
            for (var i = 0; i < RecentJobs; i++)
            {
                Add(context, $"TICKET-OK-{i:D2}", PrintJobState.Completed, DateTime.UtcNow.AddMinutes(-i));
            }

            await context.SaveChangesAsync();
        });

        _staff = await _api.SignInAsAsync("printing-staff@dineflow.test", ApplicationRoles.Staff, _restaurantId);
    }

    private void Add(AppDbContext context, string number, PrintJobState state, DateTime updatedAt)
    {
        var order = new Order
        {
            Id = Guid.NewGuid(),
            RestaurantId = _restaurantId,
            OrderNumber = number,
            Status = OrderStatus.Completed,
            PaymentStatus = PaymentStatus.Paid,
            PaymentMethod = PaymentMethod.Online,
            TotalAmount = 10m
        };

        context.Orders.Add(order);
        context.PrintJobs.Add(new PrintJob
        {
            Id = Guid.NewGuid(),
            OrderId = order.Id,
            RestaurantId = _restaurantId,
            // Unique per job: the table dedupes on this, and every row here is a distinct ticket.
            DeduplicationKey = $"{number}:{Guid.NewGuid():N}",
            State = state,
            Attempts = state == PrintJobState.DeadLetter ? 10 : 1,
            LastError = state == PrintJobState.DeadLetter ? "Printer reports ERROR." : null,
            CreatedAt = updatedAt,
            UpdatedAt = updatedAt
        });
    }

    public Task DisposeAsync() => _api.DisposeAsync();

    /// <summary>The reported symptom: "1 failed", and nothing failed in the list.</summary>
    [RequiresPostgresFact]
    public async Task ShowsTheFailedTicketEvenWhenItIsOlderThanThePage()
    {
        var page = await _staff.GetFromJsonAsync<Page>(
            $"/api/printing/jobs?restaurantId={_restaurantId}&take=30");

        Assert.Equal(1, page!.FailedCount + page.DeadLetterCount);
        Assert.Contains(page.Jobs, job => job.Order.OrderNumber == "TICKET-FAILED");
    }

    /// <summary>What needs answering is first, not buried under everything that worked.</summary>
    [RequiresPostgresFact]
    public async Task PutsWhatNeedsAttentionAtTheTop()
    {
        var page = await _staff.GetFromJsonAsync<Page>(
            $"/api/printing/jobs?restaurantId={_restaurantId}&take=30");

        Assert.Equal("TICKET-FAILED", page!.Jobs[0].Order.OrderNumber);
    }

    /// <summary>
    /// The badge and the list agree. Either number alone can be right; disagreeing is what sends
    /// somebody looking for a job that is not there.
    /// </summary>
    [RequiresPostgresFact]
    public async Task CountsTheSameJobsTheListShows()
    {
        var page = await _staff.GetFromJsonAsync<Page>(
            $"/api/printing/jobs?restaurantId={_restaurantId}&take=30");

        var shown = page!.Jobs.Count(job => job.State is "Failed" or "DeadLetter");

        Assert.Equal(page.FailedCount + page.DeadLetterCount, shown);
    }

    /// <summary>Recent work is still there; failures go first, they do not take the page over.</summary>
    [RequiresPostgresFact]
    public async Task StillShowsRecentWork()
    {
        var page = await _staff.GetFromJsonAsync<Page>(
            $"/api/printing/jobs?restaurantId={_restaurantId}&take=30");

        Assert.Equal(30, page!.Jobs.Count);
        Assert.Contains(page.Jobs, job => job.Order.OrderNumber == "TICKET-OK-00");
    }

    private sealed record Page(List<JobRow> Jobs, int PendingCount, int FailedCount, int DeadLetterCount);
    private sealed record JobRow(string State, OrderRow Order);
    private sealed record OrderRow(string OrderNumber);
}
