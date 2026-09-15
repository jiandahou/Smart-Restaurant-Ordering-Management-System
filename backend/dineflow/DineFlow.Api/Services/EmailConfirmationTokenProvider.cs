using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace DineFlow.Api.Services;

/// <summary>
/// Email confirmation links live longer than the other Identity tokens.
///
/// <para>
/// The default <see cref="DataProtectionTokenProviderOptions"/> lifespan is shared by every token
/// the default provider issues — password resets, magic-link sign-ins and email changes among
/// them. Someone confirming a new account may not open their mail until they get home, so that
/// link needs a generous window; a password reset link emphatically does not. Stretching the
/// shared value to suit the first would silently weaken the rest.
/// </para>
/// </summary>
public sealed class EmailConfirmationTokenProviderOptions : DataProtectionTokenProviderOptions
{
    public const string ProviderName = "DineFlowEmailConfirmation";

    public EmailConfirmationTokenProviderOptions()
    {
        Name = ProviderName;
        TokenLifespan = UnconfirmedCustomerCleanupService.ConfirmationWindow;
    }
}

public sealed class EmailConfirmationTokenProvider<TUser>(
    IDataProtectionProvider dataProtectionProvider,
    IOptions<EmailConfirmationTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<TUser>> logger)
    : DataProtectorTokenProvider<TUser>(dataProtectionProvider, options, logger)
    where TUser : class;
