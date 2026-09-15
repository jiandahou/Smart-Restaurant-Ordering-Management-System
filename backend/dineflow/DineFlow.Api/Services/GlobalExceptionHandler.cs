using DineFlow.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace DineFlow.Api.Services;

/// <summary>
/// Catches any exception that escapes the request pipeline, logs it, and returns a
/// consistent RFC 9457 <see cref="ProblemDetails"/> payload. Exception details are only
/// surfaced in the Development environment; production responses are redacted.
/// </summary>
public sealed class GlobalExceptionHandler(
    IProblemDetailsService problemDetailsService,
    IHostEnvironment environment,
    ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        // Contention is not a fault, and logging it as one buries the faults. A row everyone wants
        // at once is the system working; the only thing that went wrong is that somebody waited.
        var contended = DatabaseContention.IsLockWaitTimeout(exception);

        if (contended)
        {
            logger.LogWarning(
                "Gave up waiting for a contended row on {Method} {Path}",
                httpContext.Request.Method,
                httpContext.Request.Path);
        }
        else
        {
            logger.LogError(
                exception,
                "Unhandled exception for {Method} {Path}",
                httpContext.Request.Method,
                httpContext.Request.Path);
        }

        var status = contended
            ? StatusCodes.Status503ServiceUnavailable
            : StatusCodes.Status500InternalServerError;

        httpContext.Response.StatusCode = status;

        var problemDetails = new ProblemDetails
        {
            Status = status,
            Title = contended
                ? "The kitchen is busy."
                : "An unexpected error occurred.",
            Type = contended
                ? "https://tools.ietf.org/html/rfc9110#section-15.6.4"
                : "https://tools.ietf.org/html/rfc9110#section-15.6.1",
            Detail = environment.IsDevelopment() ? exception.ToString() : null,
        };

        if (contended)
        {
            // The field the apps read. Problem details carry `title`, every client here reads
            // `message`, and a sentence nobody looks at is the same as no sentence.
            problemDetails.Extensions["message"] = DatabaseContention.CustomerExplanation;
            httpContext.Response.Headers.RetryAfter = "2";
        }

        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = problemDetails,
        });
    }
}
