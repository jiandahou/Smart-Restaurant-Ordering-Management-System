using System.Text;
using System.Security.Claims;
using Amazon;
using Amazon.S3;
using DineFlow.Api.Authorization;
using DineFlow.Application.Authorization;
using DineFlow.Application.Authentication;
using DineFlow.Infrastructure.Authentication;
using DineFlow.Infrastructure.Identity;
using DineFlow.Infrastructure.Persistence;
using DineFlow.Api.Options;
using DineFlow.Api.Services;
using DineFlow.Api.Hubs;
using Fido2NetLib;
using Microsoft.AspNetCore.Authentication.Facebook;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Stripe;

// Release task entry point: applies migrations, then exits without serving traffic. Lets a deploy
// pipeline run schema changes once (e.g. an ECS run-task) instead of every application instance.
// Filtered out of the host arguments because it is a verb, not a configuration key.
var isMigrateCommand = args.Contains("--migrate", StringComparer.OrdinalIgnoreCase);

// Retention runs as its own process on purpose. The policy is explicit that the web runtime's
// database role must remain unable to mutate report rows, so the job that deletes them cannot live
// inside the API — it is scheduled separately, with its own credentials, and exits when done.
var isRetentionCommand = args.Contains("--retention", StringComparer.OrdinalIgnoreCase);
var isRetentionDryRun = args.Contains("--dry-run", StringComparer.OrdinalIgnoreCase);
var isRestoreDrillCommand = args.Contains("--retention-restore-drill", StringComparer.OrdinalIgnoreCase);
string[] maintenanceFlags =
[
    "--migrate", "--retention", "--dry-run", "--retention-restore-drill",
];
var builder = WebApplication.CreateBuilder(
    args.Where(arg => !maintenanceFlags.Contains(arg, StringComparer.OrdinalIgnoreCase)).ToArray());
const string FrontendCorsPolicy = "FrontendCorsPolicy";

if (builder.Environment.IsProduction())
{
    var compliance = builder.Configuration.GetSection(ComplianceOptions.SectionName).Get<ComplianceOptions>();
    var operatorAbn = compliance?.OperatorAbn ?? string.Empty;
    var missing = new List<string>();
    if (string.IsNullOrWhiteSpace(compliance?.OperatorName)) missing.Add("Compliance__OperatorName");
    if (operatorAbn.Length != 11 || !operatorAbn.All(char.IsDigit)) missing.Add("Compliance__OperatorAbn (11 digits)");
    if (string.IsNullOrWhiteSpace(compliance?.OperatorAddress)) missing.Add("Compliance__OperatorAddress");
    if (string.IsNullOrWhiteSpace(compliance?.PrivacyEmail)) missing.Add("Compliance__PrivacyEmail");
    if (string.IsNullOrWhiteSpace(compliance?.SupportEmail)) missing.Add("Compliance__SupportEmail");
    if (missing.Count > 0)
        throw new InvalidOperationException($"Production legal identity configuration is incomplete: {string.Join(", ", missing)}.");

    var reportRetention = builder.Configuration
        .GetSection(ReportRetentionOptions.SectionName)
        .Get<ReportRetentionOptions>() ?? new ReportRetentionOptions();
    if (!reportRetention.IsOperationallyConfigured(DateTimeOffset.UtcNow))
    {
        throw new InvalidOperationException(
            "Production report retention is not operationally configured. Set ReportRetention__ExternalMaintenanceEnabled, " +
            "ReportRetention__ScheduledJobReference, ReportRetention__ArchiveDestination, ReportRetention__LegalHoldRegister " +
            "and a restore drill within the last year in ReportRetention__LastRestoreDrillUtc.");
    }
}

builder.Services.AddControllers();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
});
builder.Services.AddMemoryCache();
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
    {
        policy
            .WithOrigins(GetConfiguredCorsOrigins(builder.Configuration))
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedHost |
        ForwardedHeaders.XForwardedProto;
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.Configure<JwtOptions>(
    builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<ReportRetentionOptions>(
    builder.Configuration.GetSection(ReportRetentionOptions.SectionName));
// Password resets, magic links and email changes all come from the default provider, so this is
// deliberately short. Email confirmation gets its own longer-lived provider below.
builder.Services.Configure<DataProtectionTokenProviderOptions>(options =>
{
    options.TokenLifespan = TimeSpan.FromHours(1);
});
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<IRefreshTokenService, RefreshTokenService>();
builder.Services.AddScoped<CartAccessService>();
// Singleton: the point is to remember failures across requests.
builder.Services.AddSingleton<CartTokenFailureTracker>();
builder.Services.AddScoped<CartRealtimeNotifier>();
builder.Services.AddScoped<OrderRealtimeNotifier>();
builder.Services.AddScoped<OrderPickupNumberService>();
builder.Services.AddScoped<MenuItemStockService>();
builder.Services.AddScoped<OrderStockLedger>();
builder.Services.AddScoped<OrderAutoAcceptanceService>();
builder.Services.AddScoped<OrderPaymentLanding>();
builder.Services.AddScoped<RefundedOrderCloser>();
builder.Services.AddScoped<OrderRefundProcessor>();
builder.Services.AddScoped<StripeOrderCheckoutService>();
builder.Services.AddScoped<PaymentSyncService>();
builder.Services.AddSingleton<PlatformSubscriptionService>();
builder.Services.AddScoped<StripeCheckoutSessionExpiry>();
builder.Services.AddScoped<TransactionalEmailOutbox>();
builder.Services.AddSingleton<IRetentionArchiveStore, FileSystemRetentionArchiveStore>();
builder.Services.AddScoped<ReportRetentionMaintenance>();
builder.Services.AddScoped<RetentionRestoreDrill>();
// The half that actually sends. Without it the outbox is a table nobody drains.
builder.Services.AddHostedService<EmailOutboxWorker>();
builder.Services.AddScoped<PaymentNotificationService>();
builder.Services.AddSingleton<TransactionalEmailLayout>();
builder.Services.AddScoped<StoredImageVerifier>();
builder.Services.AddScoped<CounterPaymentReversalService>();

// Defence in depth for the unauthenticated guest endpoints: even with tokens required, an
// attacker holding a leaked order id should not get unlimited attempts, and the lookup accepts a
// batch of ids per call.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(RateLimitPolicies.GuestOrderAccess, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 30,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Sized for a person who mistypes a password, not for a script. Partitioned by remote IP,
    // which is the client address after UseForwardedHeaders has resolved the load balancer.
    options.AddPolicy(RateLimitPolicies.Authentication, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 10,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    options.AddPolicy(RateLimitPolicies.TokenLifecycle, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 60,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    // Partitioned by source and cart id. A cart page polls every 2.5 seconds, so one diner is about
    // 24 requests a minute and a table sharing a cart is a small multiple of that; this sits well
    // above either, and well below what it takes to hammer a single cart. Enumerating cart ids
    // sidesteps this partition on purpose — that is the failure tracker's job, not this one's.
    options.AddPolicy(RateLimitPolicies.CartAccess, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            $"{httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown"}|{httpContext.Request.RouteValues["cartId"]}",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 120,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0
            }));

    options.AddPolicy(RateLimitPolicies.AuthenticationEmail, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(5),
                QueueLimit = 0
            }));

    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;

        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter =
                ((int)retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
        }

        await context.HttpContext.Response.WriteAsJsonAsync(
            new { message = "Too many attempts. Wait a moment and try again." },
            cancellationToken);
    };
});
builder.Services.AddScoped<ReportLogWriter>();
builder.Services.AddScoped<AdminActivityReportService>();
builder.Services.AddScoped<TableSessionService>();
builder.Services.AddSingleton<RestaurantOperatingHoursService>();
builder.Services.AddSingleton<PlatformBillingPresenter>();
builder.Services.AddSingleton<IOAuthLoginCodeStore, MemoryOAuthLoginCodeStore>();
builder.Services.AddSingleton<IMfaLoginChallengeStore, MemoryMfaLoginChallengeStore>();
builder.Services.AddSingleton<IMfaEmailSetupCodeStore, MemoryMfaEmailSetupCodeStore>();
builder.Services.AddSingleton<IPasskeyAssertionOptionsStore, MemoryPasskeyAssertionOptionsStore>();
builder.Services.AddSingleton<IPasskeyRegistrationOptionsStore, MemoryPasskeyRegistrationOptionsStore>();
builder.Services.Configure<EmailOptions>(options =>
{
    builder.Configuration.GetSection(EmailOptions.SectionName).Bind(options);
    options.From = FirstConfigured(builder.Configuration["AUTH_EMAIL_FROM"], builder.Configuration["EMAIL_FROM"], options.From);
    options.Server = FirstConfigured(builder.Configuration["EMAIL_SERVER"], options.Server);
    options.ResendApiKey = FirstConfigured(builder.Configuration["RESEND_API_KEY"], options.ResendApiKey);
    options.FrontendBaseUrl = FirstConfigured(
        builder.Configuration["FRONTEND_BASE_URL"],
        options.FrontendBaseUrl,
        "http://localhost:5173");
});
builder.Services.Configure<PasskeyOptions>(options =>
{
    builder.Configuration.GetSection(PasskeyOptions.SectionName).Bind(options);
    options.ServerDomain = FirstConfigured(
        builder.Configuration["PASSKEY_SERVER_DOMAIN"],
        options.ServerDomain,
        "localhost") ?? "localhost";
    options.ServerName = FirstConfigured(
        builder.Configuration["PASSKEY_SERVER_NAME"],
        options.ServerName,
        "DineFlow") ?? "DineFlow";
    options.Origins = GetConfiguredPasskeyOrigins(builder.Configuration, options.Origins);
});
builder.Services.Configure<StripeOptions>(options =>
{
    builder.Configuration.GetSection(StripeOptions.SectionName).Bind(options);
    options.SecretKey = FirstConfigured(builder.Configuration["STRIPE_SECRET_KEY"], options.SecretKey) ?? string.Empty;
    options.PublishableKey = FirstConfigured(builder.Configuration["STRIPE_PUBLISHABLE_KEY"], options.PublishableKey) ?? string.Empty;
    options.WebhookSecret = FirstConfigured(builder.Configuration["STRIPE_WEBHOOK_SECRET"], options.WebhookSecret) ?? string.Empty;
    options.ConnectWebhookSecret = FirstConfigured(
        builder.Configuration["STRIPE_CONNECT_WEBHOOK_SECRET"],
        options.ConnectWebhookSecret) ?? string.Empty;
    options.Currency = FirstConfigured(builder.Configuration["STRIPE_CURRENCY"], options.Currency, "aud") ?? "aud";
    options.SuccessUrl = FirstConfigured(
        builder.Configuration["STRIPE_SUCCESS_URL"],
        options.SuccessUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/payment/success") ?? string.Empty;
    options.CancelUrl = FirstConfigured(
        builder.Configuration["STRIPE_CANCEL_URL"],
        options.CancelUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/payment/cancelled") ?? string.Empty;
    options.ConnectReturnUrl = FirstConfigured(
        builder.Configuration["STRIPE_CONNECT_RETURN_URL"],
        options.ConnectReturnUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/restaurants?stripeConnect=return") ?? string.Empty;
    options.ConnectRefreshUrl = FirstConfigured(
        builder.Configuration["STRIPE_CONNECT_REFRESH_URL"],
        options.ConnectRefreshUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/restaurants?stripeConnect=refresh") ?? string.Empty;
    options.PlatformFeeSuccessUrl = FirstConfigured(
        builder.Configuration["STRIPE_PLATFORM_FEE_SUCCESS_URL"],
        options.PlatformFeeSuccessUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/billing?platformFee=success") ?? string.Empty;
    options.PlatformFeeCancelUrl = FirstConfigured(
        builder.Configuration["STRIPE_PLATFORM_FEE_CANCEL_URL"],
        options.PlatformFeeCancelUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/billing?platformFee=cancelled") ?? string.Empty;
    options.SubscriptionSuccessUrl = FirstConfigured(
        builder.Configuration["STRIPE_SUBSCRIPTION_SUCCESS_URL"],
        options.SubscriptionSuccessUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/billing?subscription=success") ?? string.Empty;
    options.SubscriptionCancelUrl = FirstConfigured(
        builder.Configuration["STRIPE_SUBSCRIPTION_CANCEL_URL"],
        options.SubscriptionCancelUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/billing?subscription=cancelled") ?? string.Empty;
    options.BillingPortalReturnUrl = FirstConfigured(
        builder.Configuration["STRIPE_BILLING_PORTAL_RETURN_URL"],
        options.BillingPortalReturnUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/admin/billing") ?? string.Empty;
});
builder.Services.Configure<PlatformBillingOptions>(
    builder.Configuration.GetSection(PlatformBillingOptions.SectionName));
builder.Services.PostConfigure<PlatformBillingOptions>(options =>
{
    // Flat env var alongside the section, matching how the Stripe settings are overlaid.
    if (bool.TryParse(builder.Configuration["PLATFORM_BILLING_ENFORCEMENT_ENABLED"], out var enabled))
    {
        options.EnforcementEnabled = enabled;
    }
});
builder.Services.Configure<AvatarStorageOptions>(
    builder.Configuration.GetSection(AvatarStorageOptions.SectionName));
builder.Services.AddSingleton<IAmazonS3>(serviceProvider =>
{
    var options = serviceProvider
        .GetRequiredService<Microsoft.Extensions.Options.IOptions<AvatarStorageOptions>>()
        .Value;
    var config = new AmazonS3Config
    {
        ForcePathStyle = options.ForcePathStyle
    };

    if (!string.IsNullOrWhiteSpace(options.ServiceUrl))
    {
        config.ServiceURL = options.ServiceUrl;
        config.UseHttp = options.ServiceUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase);
    }
    else
    {
        config.RegionEndpoint = RegionEndpoint.GetBySystemName(options.Region);
    }

    return new AmazonS3Client(config);
});
builder.Services.AddSingleton<IStripeClient>(serviceProvider =>
{
    var options = serviceProvider
        .GetRequiredService<Microsoft.Extensions.Options.IOptions<StripeOptions>>()
        .Value;

    return new StripeClient(options.SecretKey);
});
builder.Services.AddSingleton(serviceProvider =>
{
    var options = serviceProvider
        .GetRequiredService<Microsoft.Extensions.Options.IOptions<PasskeyOptions>>()
        .Value;

    return new Fido2(new Fido2Configuration
    {
        ServerDomain = options.ServerDomain,
        ServerName = options.ServerName,
        Origins = options.Origins.ToHashSet(StringComparer.OrdinalIgnoreCase)
    });
});
builder.Services
    .AddHttpClient<IEmailSender, ResendEmailSender>(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(15);
    });
builder.Services.AddHostedService<UnconfirmedCustomerCleanupService>();
builder.Services.AddHostedService<PendingStripePaymentReconciliationService>();
// Registered as itself as well as a hosted service, so the same reconciliation the sweep runs
// can be demanded on the spot from the billing page.
builder.Services.AddSingleton<PlatformBillingReconciliationService>();
builder.Services.AddHostedService(provider =>
    provider.GetRequiredService<PlatformBillingReconciliationService>());
builder.Services.AddHostedService<UnacceptableOrderRefundService>();
builder.Services.AddHostedService<AbandonedOrderExpiryService>();
builder.Services.AddHostedService<FinishedTableSessionSweep>();

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        // Kept in step with PasswordPolicy on the client, which explains to the user which of
        // these a candidate password is still missing.
        options.Password.RequiredLength = 8;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.User.RequireUniqueEmail = true;

        // Per-account brute-force limit. The per-IP rate limits below cannot stop a spread-out
        // attack on one account, and this cannot stop a spray across many accounts — both are
        // needed. Lockout is time-boxed so a locked-out owner is not left waiting on support.
        options.Lockout.AllowedForNewUsers = true;
        options.Lockout.MaxFailedAccessAttempts = 5;
        options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);

        options.Tokens.EmailConfirmationTokenProvider = EmailConfirmationTokenProviderOptions.ProviderName;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddPasswordValidator<MaximumLengthPasswordValidator<ApplicationUser>>()
    .AddDefaultTokenProviders()
    .AddTokenProvider<EmailConfirmationTokenProvider<ApplicationUser>>(
        EmailConfirmationTokenProviderOptions.ProviderName);

var jwtOptions = builder.Configuration
    .GetSection(JwtOptions.SectionName)
    .Get<JwtOptions>() ?? throw new InvalidOperationException("Jwt configuration is missing.");

if (string.IsNullOrWhiteSpace(jwtOptions.SecretKey))
{
    throw new InvalidOperationException("Jwt:SecretKey configuration is missing.");
}

var googleClientId = FirstConfigured(
    builder.Configuration["Authentication:Google:ClientId"],
    builder.Configuration["GOOGLE_CLIENT_ID"]);
var googleClientSecret = FirstConfigured(
    builder.Configuration["Authentication:Google:ClientSecret"],
    builder.Configuration["GOOGLE_CLIENT_SECRET"]);
var googleCallbackPath = FirstConfigured(
    builder.Configuration["Authentication:Google:CallbackPath"],
    builder.Configuration["GOOGLE_CALLBACK_PATH"],
    "/api/auth/google/signin");
var oauthFrontendBaseUrl = FirstConfigured(
    builder.Configuration["FRONTEND_BASE_URL"],
    builder.Configuration["Email:FrontendBaseUrl"],
    "http://localhost:5173")!.TrimEnd('/');

var authenticationBuilder = builder.Services
    .AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.SecretKey)),
            ClockSkew = TimeSpan.Zero
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;

                if (!string.IsNullOrWhiteSpace(accessToken) &&
                    path.StartsWithSegments("/api/hubs/orders"))
                {
                    context.Token = accessToken;
                }

                return Task.CompletedTask;
            }
        };
    });

if (!string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret))
{
    authenticationBuilder.AddGoogle(GoogleDefaults.AuthenticationScheme, options =>
    {
        options.ClientId = googleClientId;
        options.ClientSecret = googleClientSecret;
        options.CallbackPath = googleCallbackPath;
        options.SignInScheme = IdentityConstants.ExternalScheme;
        options.SaveTokens = false;
        if (builder.Environment.IsDevelopment())
        {
            options.CorrelationCookie.SameSite = SameSiteMode.Lax;
            options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        }
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect($"{oauthFrontendBaseUrl}/login?oauthError=google_failed");
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAuthorizationEndpoint = context =>
            WarnIfCallbackWillBeRejectedAsync(context, "Google");
        options.Events.OnCreatingTicket = context =>
        {
            if (context.User.TryGetProperty("picture", out var picture))
            {
                context.Identity?.AddClaim(new Claim("picture", picture.GetString() ?? string.Empty));
            }

            if (context.User.TryGetProperty("email_verified", out var emailVerified))
            {
                context.Identity?.AddClaim(new Claim("email_verified", emailVerified.GetBoolean().ToString()));
            }

            return Task.CompletedTask;
        };
    });
}

// Both providers build their callback from the incoming request, so both can be broken the same way
// by a proxy that rewrites Host. Warn once per attempt rather than letting the provider reject it
// with an error that names nothing.
static Task WarnIfCallbackWillBeRejectedAsync(
    Microsoft.AspNetCore.Authentication.RedirectContext<OAuthOptions> context,
    string provider)
{
    var problem = OAuthCallbackPolicy.DescribeProblem(
        context.Request.Scheme,
        context.Request.Host.Value,
        context.Options.CallbackPath);

    if (problem is not null)
    {
        context.HttpContext.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("DineFlow.Api.OAuth")
            .LogError("{Provider} sign-in will fail. {Problem}", provider, problem);
    }

    context.Response.Redirect(context.RedirectUri);
    return Task.CompletedTask;
}

var facebookAppId = FirstConfigured(
    builder.Configuration["Authentication:Facebook:AppId"],
    builder.Configuration["FACEBOOK_APP_ID"]);
var facebookAppSecret = FirstConfigured(
    builder.Configuration["Authentication:Facebook:AppSecret"],
    builder.Configuration["FACEBOOK_APP_SECRET"]);
var facebookCallbackPath = FirstConfigured(
    builder.Configuration["Authentication:Facebook:CallbackPath"],
    builder.Configuration["FACEBOOK_CALLBACK_PATH"],
    "/api/auth/facebook/signin");

if (!string.IsNullOrWhiteSpace(facebookAppId) && !string.IsNullOrWhiteSpace(facebookAppSecret))
{
    authenticationBuilder.AddFacebook(FacebookDefaults.AuthenticationScheme, options =>
    {
        options.AppId = facebookAppId;
        options.AppSecret = facebookAppSecret;
        options.CallbackPath = facebookCallbackPath;
        options.SignInScheme = IdentityConstants.ExternalScheme;
        options.SaveTokens = false;
        if (builder.Environment.IsDevelopment())
        {
            options.CorrelationCookie.SameSite = SameSiteMode.Lax;
            options.CorrelationCookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        }
        options.Events.OnRedirectToAuthorizationEndpoint = context =>
            WarnIfCallbackWillBeRejectedAsync(context, "Facebook");
        options.Events.OnRemoteFailure = context =>
        {
            context.HandleResponse();
            context.Response.Redirect($"{oauthFrontendBaseUrl}/login?oauthError=facebook_failed");
            return Task.CompletedTask;
        };
        options.Fields.Add("picture");
        options.Events.OnCreatingTicket = context =>
        {
            if (context.User.TryGetProperty("picture", out var picture) &&
                picture.TryGetProperty("data", out var pictureData) &&
                pictureData.TryGetProperty("url", out var pictureUrl))
            {
                context.Identity?.AddClaim(new Claim("picture", pictureUrl.GetString() ?? string.Empty));
            }

            return Task.CompletedTask;
        };
    });
}

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AuthorizationPolicies.PlatformOwnerOnly, policy =>
        policy.RequireRole(ApplicationRoles.PlatformOwner));

    options.AddPolicy(AuthorizationPolicies.RestaurantOwnerApi, policy =>
        policy.RequireRole(
            ApplicationRoles.PlatformOwner,
            ApplicationRoles.RestaurantOwner));

    options.AddPolicy(AuthorizationPolicies.AdminApi, policy =>
        policy.RequireRole(
            ApplicationRoles.PlatformOwner,
            ApplicationRoles.RestaurantOwner,
            ApplicationRoles.Admin));

    options.AddPolicy(AuthorizationPolicies.StaffApi, policy =>
        policy.RequireRole(
            ApplicationRoles.PlatformOwner,
            ApplicationRoles.RestaurantOwner,
            ApplicationRoles.Admin,
            ApplicationRoles.Staff));

    options.AddPolicy(AuthorizationPolicies.RestaurantStaffApi, policy =>
        policy.RequireRole(
            ApplicationRoles.RestaurantOwner,
            ApplicationRoles.Admin,
            ApplicationRoles.Staff));
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter a valid JWT bearer token."
    });

    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });

    options.MapType<IFormFile>(() => new OpenApiSchema
    {
        Type = "string",
        Format = "binary"
    });
});

var app = builder.Build();

{
    // Webhook events are bound to the endpoint they were delivered to, and that binding needs two
    // distinguishable secrets to exist. Where it cannot be done the endpoint still works and simply
    // accepts what either secret signed — which is the older, laxer behaviour, and worth saying out
    // loud at startup rather than leaving somebody to infer it from a security review.
    var stripeStartupOptions = app.Services
        .GetRequiredService<Microsoft.Extensions.Options.IOptions<StripeOptions>>()
        .Value;
    var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Stripe.Webhooks");

    if (!string.IsNullOrWhiteSpace(stripeStartupOptions.SecretKey))
    {
        if (string.IsNullOrWhiteSpace(stripeStartupOptions.ConnectWebhookSecret))
        {
            startupLogger.LogWarning(
                "Stripe:ConnectWebhookSecret is not set, so webhook events cannot be bound to the "
                + "endpoint that delivered them. Set it to the Connect endpoint's signing secret.");
        }
        else if (string.Equals(
            stripeStartupOptions.ConnectWebhookSecret,
            stripeStartupOptions.WebhookSecret,
            StringComparison.Ordinal))
        {
            startupLogger.LogWarning(
                "Stripe:WebhookSecret and Stripe:ConnectWebhookSecret are the same value, so webhook "
                + "events cannot be bound to the endpoint that delivered them. Each Stripe endpoint "
                + "has its own signing secret.");
        }
    }
}

app.UseExceptionHandler();

app.UseForwardedHeaders();

app.UseSwagger();
app.UseSwaggerUI();

app.UseHttpsRedirection();
app.UseStaticFiles();

var webRootPath = app.Environment.WebRootPath;
if (string.IsNullOrWhiteSpace(webRootPath))
{
    webRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot");
}

var uploadsPath = Path.Combine(webRootPath, "uploads");
Directory.CreateDirectory(uploadsPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(uploadsPath),
    RequestPath = "/uploads"
});

app.UseCors(FrontendCorsPolicy);
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "DineFlow.Api",
    checkedAt = DateTimeOffset.UtcNow
}));

app.MapGet("/health/ready", async (AppDbContext dbContext) =>
{
    var canConnect = await dbContext.Database.CanConnectAsync();

    if (!canConnect)
    {
        return Results.Problem(
            title: "Database is not reachable.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    return Results.Ok(new
    {
        status = "ready",
        service = "DineFlow.Api",
        database = "ok",
        checkedAt = DateTimeOffset.UtcNow
    });
});

Console.WriteLine("Health check endpoint registered at /health");
app.MapControllers();
app.MapHub<CartHub>("/api/hubs/carts");
app.MapHub<OrderHub>("/api/hubs/orders");
// Schema changes are a release step, not a side effect of a container starting: several tasks can
// boot at once, and an unreviewed migration must never be applied to a live database by accident.
// Production therefore defaults to off — run `dotnet DineFlow.Api.dll --migrate` as a release task
// (or `dotnet ef database update`) before rolling out the new revision.
var migrateOnStartup = app.Configuration.GetValue<bool?>("Database:MigrateOnStartup")
    ?? !app.Environment.IsProduction();

if (migrateOnStartup || isMigrateCommand)
{
    Console.WriteLine("Applying database migrations...");
    using var migrationScope = app.Services.CreateScope();
    var dbContext = migrationScope.ServiceProvider.GetRequiredService<AppDbContext>();
    await dbContext.Database.MigrateAsync();
    Console.WriteLine("Database migrations applied.");
}
else
{
    Console.WriteLine(
        "Skipping startup migrations (Database:MigrateOnStartup is off). "
            + "Apply them as a release task before deploying a schema change.");
}

// Roles and the bootstrap owner are what a fresh deployment needs to be usable at all, and both
// are idempotent. Demo data is neither, so it is opt-out in development and refused in Production.
try
{
    await IdentitySeeder.SeedRolesAsync(app.Services);
    await IdentitySeeder.SeedPlatformOwnerAsync(app.Services);
}
catch (Exception exception) when (!migrateOnStartup && !isMigrateCommand)
{
    // The likeliest cause by far is a database whose migrations have not been applied yet, which
    // is otherwise reported as an unrelated-looking "relation does not exist".
    throw new InvalidOperationException(
        "Could not prepare roles and the platform owner. If this deployment has pending migrations, "
            + "run the release task (dotnet DineFlow.Api.dll --migrate) before starting the API.",
        exception);
}

var seedDemoData = app.Configuration.GetValue<bool?>("Seed:DemoData") ?? !app.Environment.IsProduction();

if (seedDemoData && app.Environment.IsProduction())
{
    Console.WriteLine(
        "Ignoring Seed:DemoData: demo restaurants, orders and shared-password accounts are never "
            + "seeded in Production.");
}
else if (seedDemoData)
{
    await IdentitySeeder.SeedDemoDataAsync(app.Services);
}

if (isRetentionCommand || isRestoreDrillCommand)
{
    var retentionOptions = app.Configuration
        .GetSection(ReportRetentionOptions.SectionName)
        .Get<ReportRetentionOptions>() ?? new ReportRetentionOptions();
    var archiveDirectory = retentionOptions.ArchiveDestination;

    if (string.IsNullOrWhiteSpace(archiveDirectory))
    {
        // Refused rather than defaulted. A retention run that archives somewhere nobody chose is
        // indistinguishable from one that deletes without archiving.
        Console.Error.WriteLine(
            "ReportRetention__ArchiveDestination is not set. Point it at the mounted, encrypted "
                + "archive directory before running retention.");
        return;
    }

    using var maintenanceScope = app.Services.CreateScope();

    if (isRestoreDrillCommand)
    {
        var drill = maintenanceScope.ServiceProvider.GetRequiredService<RetentionRestoreDrill>();
        var results = await drill.RunAsync(archiveDirectory, CancellationToken.None);
        var failed = results.Count(result => !result.Verified);

        Console.WriteLine($"Restore drill: {results.Count - failed} verified, {failed} failed.");

        if (failed > 0)
        {
            // A non-zero exit is what makes this a gate rather than a report.
            Environment.ExitCode = 1;
        }

        return;
    }

    var maintenance = maintenanceScope.ServiceProvider.GetRequiredService<ReportRetentionMaintenance>();
    var outcomes = await maintenance.RunAsync(
        archiveDirectory,
        DateTime.UtcNow,
        isRetentionDryRun,
        CancellationToken.None);

    foreach (var outcome in outcomes)
    {
        Console.WriteLine(
            $"{outcome.RecordType}: {outcome.Eligible} past retention, {outcome.HeldBack} held, "
                + $"{outcome.Archived} archived, {outcome.Deleted} deleted"
                + (outcome.ArchiveFile is null ? "." : $" -> {outcome.ArchiveFile} ({outcome.Sha256})."));
    }

    Console.WriteLine(isRetentionDryRun
        ? "Retention dry run complete; nothing was deleted."
        : "Retention run complete; not starting the web host.");
    return;
}

if (isMigrateCommand)
{
    Console.WriteLine("Migrate command complete; not starting the web host.");
    return;
}

app.Run();

static string? FirstConfigured(params string?[] values)
{
    return values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
}

static string[] GetConfiguredPasskeyOrigins(IConfiguration configuration, string[] configuredOrigins)
{
    var envValue = configuration["PASSKEY_ORIGINS"];

    if (!string.IsNullOrWhiteSpace(envValue))
    {
        return envValue
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToArray();
    }

    return configuredOrigins.Length > 0
        ? configuredOrigins
        : ["http://localhost:5173"];
}

static string[] GetConfiguredCorsOrigins(IConfiguration configuration)
{
    var configuredOrigins = configuration["CORS_ALLOWED_ORIGINS"];
    var origins = new List<string>();

    if (!string.IsNullOrWhiteSpace(configuredOrigins))
    {
        origins.AddRange(configuredOrigins
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    }

    var frontendBaseUrl = FirstConfigured(
        configuration["FRONTEND_BASE_URL"],
        configuration["Email:FrontendBaseUrl"]);

    if (!string.IsNullOrWhiteSpace(frontendBaseUrl))
    {
        origins.Add(frontendBaseUrl.TrimEnd('/'));
    }

    origins.Add("http://localhost:5173");
    origins.Add("https://dineflow.theunknownfish.com");

    return origins
        .Where(origin => Uri.TryCreate(origin, UriKind.Absolute, out _))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();
}

public partial class Program;
