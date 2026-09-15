namespace DineFlow.Application.Authentication;

/// <summary>
/// Tells a token replayed by its own owner apart from one replayed by a thief.
/// </summary>
/// <remarks>
/// <para>
/// Refresh tokens rotate on every use, and presenting an already-rotated one is the signature of a
/// stolen copy — so it revokes every token the account holds. It is also the signature of something
/// entirely innocent: two tabs of the same browser share one refresh token in local storage, and
/// when both wake after the access token has expired, both present it. One rotates; the other is
/// treated as a thief, and every device the account owns is signed out.
/// </para>
/// <para>
/// A restaurant feels that as lost orders. The till stops showing new tickets, stops sounding and
/// stops printing, and nobody notices until a customer asks where their food is.
/// </para>
/// <para>
/// The two cases are separable in time. The losing tab replays within moments of the winner, because
/// both were triggered by the same expiry; a thief has to obtain the token first, and replays it
/// later. So a replay inside a short window after the rotation is treated as the race it almost
/// always is, and one after the window is still treated as theft.
/// </para>
/// </remarks>
public static class RefreshTokenRotationRace
{
    /// <summary>
    /// How long after a rotation the same token may be replayed without it counting as theft.
    /// </summary>
    /// <remarks>
    /// Long enough for a phone that woke on a weak connection to finish a request it started before
    /// its sibling won, and short enough that it is no use to somebody who has to steal the token
    /// first.
    /// </remarks>
    public static readonly TimeSpan GracePeriod = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Whether a token rotated away at <paramref name="rotatedAt"/> and presented again at
    /// <paramref name="presentedAt"/> is the owner racing itself rather than a replay to defend
    /// against.
    /// </summary>
    public static bool IsRace(DateTime rotatedAt, DateTime presentedAt) =>
        presentedAt >= rotatedAt && presentedAt - rotatedAt <= GracePeriod;
}
