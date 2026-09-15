using Stripe;

namespace DineFlow.Tests.Infrastructure;

/// <summary>
/// Stands in for Stripe so a test can say what Stripe would have answered.
/// </summary>
/// <remarks>
/// The difference under test — an expired Checkout session whose payment intent Stripe reports as
/// canceled — only exists in what Stripe returns, so there is no way to reach it without deciding
/// those answers. Requests are matched on their path, which is how the two objects are told apart.
/// </remarks>
public sealed class StubStripeClient : IStripeClient
{
    private readonly Dictionary<string, IStripeEntity> _answers = new(StringComparer.Ordinal);

    /// <summary>Every path this client was asked for, in order, so a test can say what was fetched.</summary>
    public List<string> Requested { get; } = [];

    public string ApiBase => "https://api.stripe.com";
    public string ApiKey => "sk_test_stub";
    public string ClientId => "ca_stub";
    public string ConnectBase => "https://connect.stripe.com";
    public string FilesBase => "https://files.stripe.com";
    public string MeterEventsBase => "https://meter-events.stripe.com";

    /// <summary>Answers any request whose path contains <paramref name="pathFragment"/>.</summary>
    public StubStripeClient Answering(string pathFragment, IStripeEntity entity)
    {
        _answers[pathFragment] = entity;
        return this;
    }

    public Task<T> RequestAsync<T>(
        HttpMethod method,
        string path,
        BaseOptions options,
        RequestOptions requestOptions,
        CancellationToken cancellationToken = default)
        where T : IStripeEntity
    {
        Requested.Add(path);

        foreach (var (fragment, entity) in _answers)
        {
            if (path.Contains(fragment, StringComparison.Ordinal) && entity is T typed)
            {
                return Task.FromResult(typed);
            }
        }

        throw new StripeException($"The test stub was not told what Stripe answers for {path}.");
    }

    public Task<Stream> RequestStreamingAsync(
        HttpMethod method,
        string path,
        BaseOptions options,
        RequestOptions requestOptions,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException("No test needs a streamed Stripe response.");
}
