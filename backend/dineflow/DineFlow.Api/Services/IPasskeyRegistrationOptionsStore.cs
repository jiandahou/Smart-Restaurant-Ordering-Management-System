using Fido2NetLib;

namespace DineFlow.Api.Services;

public interface IPasskeyRegistrationOptionsStore
{
    void Store(string userId, CredentialCreateOptions options);

    bool TryConsume(string userId, out CredentialCreateOptions options);
}
