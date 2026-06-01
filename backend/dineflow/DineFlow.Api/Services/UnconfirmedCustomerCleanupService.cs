using DineFlow.Application.Authorization;
using DineFlow.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace DineFlow.Api.Services;

public sealed class UnconfirmedCustomerCleanupService : BackgroundService
{
    public static readonly TimeSpan ConfirmationWindow = TimeSpan.FromHours(1);

    private static readonly TimeSpan CleanupInterval = TimeSpan.FromMinutes(15);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<UnconfirmedCustomerCleanupService> _logger;

    public UnconfirmedCustomerCleanupService(
        IServiceScopeFactory scopeFactory,
        ILogger<UnconfirmedCustomerCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CleanupInterval);

        await DeleteExpiredCustomersAsync(stoppingToken);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await DeleteExpiredCustomersAsync(stoppingToken);
        }
    }

    private async Task DeleteExpiredCustomersAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var userManager = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var cutoff = DateTime.UtcNow.Subtract(ConfirmationWindow);
            var expiredUsers = await userManager.Users
                .Where(user => !user.EmailConfirmed && user.CreatedAt <= cutoff)
                .ToListAsync(cancellationToken);

            foreach (var user in expiredUsers)
            {
                if (!await userManager.IsInRoleAsync(user, ApplicationRoles.Customer))
                {
                    continue;
                }

                var result = await userManager.DeleteAsync(user);

                if (result.Succeeded)
                {
                    _logger.LogInformation("Deleted expired unconfirmed customer account {UserId}.", user.Id);
                }
                else
                {
                    _logger.LogWarning(
                        "Failed to delete expired unconfirmed customer account {UserId}: {Errors}",
                        user.Id,
                        string.Join(", ", result.Errors.Select(error => error.Description)));
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to clean up expired unconfirmed customer accounts.");
        }
    }
}
