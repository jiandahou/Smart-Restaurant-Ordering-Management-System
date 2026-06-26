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
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Stripe;

var builder = WebApplication.CreateBuilder(args);
const string FrontendCorsPolicy = "FrontendCorsPolicy";

builder.Services.AddControllers();
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
builder.Services.Configure<DataProtectionTokenProviderOptions>(options =>
{
    options.TokenLifespan = UnconfirmedCustomerCleanupService.ConfirmationWindow;
});
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<CartAccessService>();
builder.Services.AddScoped<CartRealtimeNotifier>();
builder.Services.AddScoped<OrderRealtimeNotifier>();
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
    options.Currency = FirstConfigured(builder.Configuration["STRIPE_CURRENCY"], options.Currency, "aud") ?? "aud";
    options.SuccessUrl = FirstConfigured(
        builder.Configuration["STRIPE_SUCCESS_URL"],
        options.SuccessUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/payment/success") ?? string.Empty;
    options.CancelUrl = FirstConfigured(
        builder.Configuration["STRIPE_CANCEL_URL"],
        options.CancelUrl,
        $"{FirstConfigured(builder.Configuration["FRONTEND_BASE_URL"], "http://localhost:5173")}/payment/cancelled") ?? string.Empty;
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

builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        options.Password.RequiredLength = 6;
        options.Password.RequireDigit = true;
        options.Password.RequireLowercase = true;
        options.Password.RequireUppercase = true;
        options.Password.RequireNonAlphanumeric = true;
        options.User.RequireUniqueEmail = true;
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

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
Console.WriteLine("Applying database migrations...");
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await dbContext.Database.MigrateAsync();
}
await IdentitySeeder.SeedAsync(app.Services);
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
