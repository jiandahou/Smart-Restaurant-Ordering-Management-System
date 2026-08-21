using DineFlow.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// A cart participant token is the entire credential for a public cart — no account, no password.
/// Nothing capped how fast one source could try them: eighty invalid tokens in a burst were each
/// answered with a plain 401, as fast as they could be sent.
///
/// <para>
/// This counts failures rather than requests, which is the only version of the rule that can be set
/// tightly. A cart page polls every 2.5 seconds, so a restaurant whose diners share one wifi
/// connection makes hundreds of legitimate cart requests a minute from a single address; a cap on
/// requests strict enough to stop guessing would take the venue offline instead.
/// </para>
/// </summary>
public sealed class CartTokenFailureTrackerTests
{
    private static CartTokenFailureTracker Tracker() =>
        new(new MemoryCache(new MemoryCacheOptions { SizeLimit = 1_000 }),
            NullLogger<CartTokenFailureTracker>.Instance);

    [Fact]
    public void ASourceStartsWithItsFullBudget()
    {
        Assert.False(Tracker().IsLockedOut("203.0.113.1"));
    }

    [Fact]
    public void OneMistakeDoesNotLockAnybodyOut()
    {
        // A person arriving with a stale link fails once and their client stops. Locking them out
        // for that would break an ordinary recovery.
        var tracker = Tracker();

        tracker.RecordFailure("203.0.113.1");

        Assert.False(tracker.IsLockedOut("203.0.113.1"));
    }

    [Fact]
    public void ASourceIsLockedOutOnceItSpendsTheBudget()
    {
        var tracker = Tracker();

        for (var attempt = 0; attempt < CartTokenFailureTracker.FailureLimit; attempt++)
        {
            Assert.False(tracker.IsLockedOut("203.0.113.1"));
            tracker.RecordFailure("203.0.113.1");
        }

        Assert.True(tracker.IsLockedOut("203.0.113.1"));
    }

    [Fact]
    public void TheLockoutIsAnnouncedOnceRatherThanOnEveryAttemptAfterIt()
    {
        // A script keeps going after being shut out. Logging each attempt would bury the one line
        // that matters under thousands that do not.
        var tracker = Tracker();
        var announcements = 0;

        for (var attempt = 0; attempt < CartTokenFailureTracker.FailureLimit + 25; attempt++)
        {
            if (tracker.RecordFailure("203.0.113.1"))
            {
                announcements++;
            }
        }

        Assert.Equal(1, announcements);
    }

    [Fact]
    public void OneSourceCannotLockOutAnother()
    {
        // Otherwise anyone could shut a restaurant's own wifi out of its carts.
        var tracker = Tracker();

        for (var attempt = 0; attempt < CartTokenFailureTracker.FailureLimit + 5; attempt++)
        {
            tracker.RecordFailure("203.0.113.1");
        }

        Assert.True(tracker.IsLockedOut("203.0.113.1"));
        Assert.False(tracker.IsLockedOut("203.0.113.2"));
    }

    [Fact]
    public void ProvingYouHoldARealTokenForgivesEarlierFailures()
    {
        // Several people behind one address, one of whom had a stale link. The ones with real
        // tokens must not inherit their failures.
        var tracker = Tracker();

        for (var attempt = 0; attempt < CartTokenFailureTracker.FailureLimit - 1; attempt++)
        {
            tracker.RecordFailure("203.0.113.1");
        }

        tracker.Clear("203.0.113.1");

        for (var attempt = 0; attempt < CartTokenFailureTracker.FailureLimit - 1; attempt++)
        {
            tracker.RecordFailure("203.0.113.1");
        }

        Assert.False(tracker.IsLockedOut("203.0.113.1"));
    }

    [Fact]
    public void TheBudgetIsSmallEnoughToMatterAndLargeEnoughForAPerson()
    {
        // Recorded so the numbers cannot drift into either uselessness or an outage unnoticed.
        Assert.InRange(CartTokenFailureTracker.FailureLimit, 5, 50);
        Assert.InRange(CartTokenFailureTracker.Window, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(30));
    }

    /// <summary>
    /// The check runs before the cart is looked up, and only rejected tokens are counted. Counting
    /// every request instead is the version of this that takes a busy restaurant offline.
    /// </summary>
    [Fact]
    public void OnlyRejectedTokensAreCounted()
    {
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("access.Failure == CartAccessFailure.InvalidToken", source, StringComparison.Ordinal);
        Assert.Contains("cartTokenFailureTracker.RecordFailure(source)", source, StringComparison.Ordinal);

        // The lockout is applied after the lookup on purpose. Refusing before it is cheaper, and
        // lets anyone sharing a restaurant's wifi take every diner behind it offline.
        var lockedOut = source.IndexOf("cartTokenFailureTracker.IsLockedOut", StringComparison.Ordinal);
        var lookup = source.IndexOf("cartAccessService.AuthorizeAsync", StringComparison.Ordinal);

        Assert.True(lockedOut > lookup, "The lockout is applied to the request rather than to its outcome.");
    }

    /// <summary>
    /// The property that makes this safe to deploy: a valid token is never refused, whoever else
    /// shares the address. Without it the defence becomes the attack.
    /// </summary>
    [Fact]
    public void AValidTokenIsNeverRefusedBecauseOfSomebodyElse()
    {
        var source = File.ReadAllText(ControllerPath());
        var start = source.IndexOf("private async Task<CartAccessResult> AuthorizeCartAsync", StringComparison.Ordinal);
        var body = source[start..(start + 2_500)];

        var invalidBranch = body.IndexOf("access.Failure == CartAccessFailure.InvalidToken", StringComparison.Ordinal);
        var lockedOut = body.IndexOf("IsLockedOut", StringComparison.Ordinal);

        Assert.True(invalidBranch >= 0 && lockedOut > invalidBranch,
            "The 429 is not confined to requests whose token was actually rejected.");
    }

    [Fact]
    public void TheRefusalIsA429AndSaysWhy()
    {
        var source = File.ReadAllText(ControllerPath());

        Assert.Contains("Status429TooManyRequests", source, StringComparison.Ordinal);
        Assert.Contains("cart_token_attempts_exceeded", source, StringComparison.Ordinal);
    }

    /// <summary>
    /// The second layer: a ceiling on how hard one source can hammer one cart. Partitioned by cart
    /// as well as source, because the pages holding a token poll constantly and a shared connection
    /// at a busy venue would otherwise exhaust a per-source budget on legitimate traffic.
    /// </summary>
    [Fact]
    public void CartEndpointsHaveTheirOwnRateLimitPolicy()
    {
        var controller = File.ReadAllText(ControllerPath());
        var program = File.ReadAllText(Path.Combine(SolutionDirectory(), "DineFlow.Api", "Program.cs"));

        Assert.Contains("EnableRateLimiting(RateLimitPolicies.CartAccess)", controller, StringComparison.Ordinal);
        Assert.Contains("RateLimitPolicies.CartAccess", program, StringComparison.Ordinal);
        Assert.Contains("RouteValues[\"cartId\"]", program, StringComparison.Ordinal);
    }

    private static string ControllerPath() =>
        Path.Combine(SolutionDirectory(), "DineFlow.Api", "Controllers", "PublicCartsController.cs");

    private static string SolutionDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "DineFlow.sln")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return directory!.FullName;
    }
}
