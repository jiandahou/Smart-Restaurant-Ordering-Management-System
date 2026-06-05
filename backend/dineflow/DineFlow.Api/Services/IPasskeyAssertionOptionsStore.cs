using Fido2NetLib;

namespace DineFlow.Api.Services;

public interface IPasskeyAssertionOptionsStore
{
    void Store(string challenge, AssertionOptions options);

    bool TryConsume(string challenge, out AssertionOptions options);
}
