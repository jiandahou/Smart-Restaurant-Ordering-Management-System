namespace DineFlow.Api.Services;

public interface IOAuthLoginCodeStore
{
    string CreateCode(string userId);

    bool TryConsumeCode(string code, out string userId);
}
