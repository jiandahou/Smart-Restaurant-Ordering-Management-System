using System.Net;
using System.Text.Json;
using DineFlow.Infrastructure.Payments;
using DineFlow.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace DineFlow.Tests;

/// <summary>
/// PS-WEB-02: a webhook secret may only speak for the endpoint it belongs to.
/// </summary>
/// <remarks>
/// <para>
/// Two endpoints, two signing secrets — one for the platform account, one for connected accounts.
/// Verification tried both and took whichever passed, then acted on the event as though the
/// question of where it came from had been settled. A secret proves who sent the payload; it says
/// nothing about whether they were entitled to speak for the other endpoint.
/// </para>
/// <para>
/// The test case has been written down as P0 in <c>docs/testing/payment-system-test-cases.md</c>
/// for some time, describing behaviour the code did not have. This is that case, run for real
/// against the endpoint so the signature check and the event parsing are the ones a webhook meets.
/// </para>
/// </remarks>
public sealed class StripeWebhookDestinationTests : IAsyncLifetime
{
    private readonly DineFlowApiFactory _api = new();

    public async Task InitializeAsync() => await _api.InitializeAsync();

    public Task DisposeAsync() => _api.DisposeAsync();

    /// <summary>
    /// An event type this endpoint has no handler for, so what is being measured is the gate and
    /// not somebody's handler.
    /// </summary>
    /// <remarks>
    /// Ignoring an unfamiliar event and banking it anyway is the endpoint's documented behaviour
    /// (PS-WEB-09), which makes it the cleanest thing to send: accepted means banked, refused means
    /// not, and no other code runs in between to muddy which of those happened.
    /// </remarks>
    private static string UnhandledEvent(string eventId, string? connectedAccount) =>
        JsonSerializer.Serialize(new
        {
            id = eventId,
            type = "invoice.upcoming",
            account = connectedAccount,
            api_version = Stripe.StripeConfiguration.ApiVersion,
            created = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            data = new
            {
                @object = new
                {
                    id = "in_destination_test",
                    @object = "invoice",
                    metadata = new Dictionary<string, string>(),
                }
            }
        });

    /// <summary>A restaurant's own event: it names the account it came from.</summary>
    private static string ConnectedAccountEvent(string eventId) =>
        UnhandledEvent(eventId, "acct_connected_test");

    /// <summary>A platform event: no connected account anywhere in it.</summary>
    private static string PlatformEvent(string eventId) => UnhandledEvent(eventId, connectedAccount: null);

    private async Task<HttpResponseMessage> DeliverAsync(string payload, string secret) =>
        await _api.CreateClient().SendAsync(StripeWebhookRequest.Create(payload, secret));

    private async Task<bool> WasBankedAsync(string eventId)
    {
        var banked = false;
        await _api.UseDbAsync(async context =>
            banked = await context.StripeWebhookEvents.AnyAsync(item => item.EventId == eventId));
        return banked;
    }

    /// <summary>
    /// Someone holding the platform secret cannot speak for a restaurant's account.
    /// </summary>
    [RequiresPostgresFact]
    public async Task ThePlatformSecretCannotSignAConnectedAccountsEvent()
    {
        const string eventId = "evt_wrong_destination_connect";

        var response = await DeliverAsync(
            ConnectedAccountEvent(eventId),
            DineFlowApiFactory.StripeWebhookSecret);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(await WasBankedAsync(eventId));
    }

    /// <summary>And the reverse: the Connect secret cannot speak for the platform's own account.</summary>
    [RequiresPostgresFact]
    public async Task TheConnectSecretCannotSignAPlatformEvent()
    {
        const string eventId = "evt_wrong_destination_platform";

        var response = await DeliverAsync(
            PlatformEvent(eventId),
            DineFlowApiFactory.StripeConnectWebhookSecret);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.False(await WasBankedAsync(eventId));
    }

    /// <summary>
    /// The refusal is indistinguishable from a bad signature, so probing which secret belongs to
    /// which endpoint teaches the sender nothing.
    /// </summary>
    [RequiresPostgresFact]
    public async Task AMisroutedEventIsRefusedInTheSameWordsAsAForgedOne()
    {
        var misrouted = await DeliverAsync(
            ConnectedAccountEvent("evt_wrong_destination_wording"),
            DineFlowApiFactory.StripeWebhookSecret);
        var forged = await DeliverAsync(
            ConnectedAccountEvent("evt_forged_wording"),
            "whsec_not_a_secret_anyone_issued");

        Assert.Equal(HttpStatusCode.BadRequest, misrouted.StatusCode);
        Assert.Equal(
            await forged.Content.ReadAsStringAsync(),
            await misrouted.Content.ReadAsStringAsync());
    }

    /// <summary>Each secret still works for its own endpoint, which is the point of having two.</summary>
    [RequiresPostgresFact]
    public async Task EachSecretStillSpeaksForItsOwnEndpoint()
    {
        const string connectEventId = "evt_right_destination_connect";
        const string platformEventId = "evt_right_destination_platform";

        var connect = await DeliverAsync(
            ConnectedAccountEvent(connectEventId),
            DineFlowApiFactory.StripeConnectWebhookSecret);
        var platform = await DeliverAsync(
            PlatformEvent(platformEventId),
            DineFlowApiFactory.StripeWebhookSecret);

        Assert.Equal(HttpStatusCode.OK, connect.StatusCode);
        Assert.Equal(HttpStatusCode.OK, platform.StatusCode);
        Assert.True(await WasBankedAsync(connectEventId));
        Assert.True(await WasBankedAsync(platformEventId));
    }
}

/// <summary>The rule itself, without a web server around it.</summary>
public class StripeWebhookRoutingTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEventWithNoAccountCameFromThePlatform(string? account) =>
        Assert.Equal(StripeWebhookDestination.Platform, StripeWebhookRouting.DestinationOf(account));

    [Fact]
    public void AnEventNamingAnAccountCameFromIt() =>
        Assert.Equal(
            StripeWebhookDestination.ConnectedAccount,
            StripeWebhookRouting.DestinationOf("acct_123"));

    [Fact]
    public void ASecretSpeaksOnlyForItsOwnEndpoint()
    {
        Assert.True(StripeWebhookRouting.Accepts(StripeWebhookDestination.Platform, null));
        Assert.False(StripeWebhookRouting.Accepts(StripeWebhookDestination.Platform, "acct_123"));
        Assert.True(StripeWebhookRouting.Accepts(StripeWebhookDestination.ConnectedAccount, "acct_123"));
        Assert.False(StripeWebhookRouting.Accepts(StripeWebhookDestination.ConnectedAccount, null));
    }

    /// <summary>
    /// A deployment with one secret has nothing to bind against. Refusing everything there would
    /// take a working restaurant's payments offline over a settings page, so it is allowed — which
    /// is worth stating in a test rather than leaving as an accident of a null check.
    /// </summary>
    [Fact]
    public void ADeploymentThatCannotTellTheEndpointsApartIsNotPunishedForIt()
    {
        Assert.True(StripeWebhookRouting.Accepts(null, null));
        Assert.True(StripeWebhookRouting.Accepts(null, "acct_123"));
    }

    [Fact]
    public void TheLogSaysWhichWayRoundItWentWrong()
    {
        Assert.Contains(
            "acct_123",
            StripeWebhookRouting.ExplainRefusal(StripeWebhookDestination.Platform, "acct_123"));
        Assert.Contains(
            "no connected account",
            StripeWebhookRouting.ExplainRefusal(StripeWebhookDestination.ConnectedAccount, null));
    }
}
