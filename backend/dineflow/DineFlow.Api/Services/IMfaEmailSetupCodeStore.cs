namespace DineFlow.Api.Services;

public interface IMfaEmailSetupCodeStore
{
    void Store(string userId, string code);

    bool TryConsume(string userId, string code);
}
