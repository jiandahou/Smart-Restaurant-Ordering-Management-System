namespace DineFlow.Application.Authentication;

public interface IJwtTokenService
{
    string GenerateToken(
        string userId,
        string? email,
        string? userName,
        IEnumerable<string> roles);
}
