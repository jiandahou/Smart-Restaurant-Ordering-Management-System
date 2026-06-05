namespace DineFlow.Api.Services;

public sealed record MfaLoginChallenge(
    string UserId,
    IReadOnlyCollection<string> Methods,
    string? EmailCode);

public interface IMfaLoginChallengeStore
{
    string Create(string userId, IReadOnlyCollection<string> methods, string? emailCode);

    bool TryGet(string challengeId, out MfaLoginChallenge challenge);

    bool TryConsume(string challengeId, out MfaLoginChallenge challenge);
}
