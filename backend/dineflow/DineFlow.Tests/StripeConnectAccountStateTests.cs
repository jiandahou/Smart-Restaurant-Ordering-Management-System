using System.Text.Json;
using DineFlow.Api.Services;
using Xunit;

namespace DineFlow.Tests;

public class StripeConnectAccountStateTests
{
    [Fact]
    public void Read_LegacyRequirementArray_RemainsBackwardCompatible()
    {
        var snapshot = StripeConnectAccountState.Read(
            """["external_account","company.tax_id","external_account"]""");

        Assert.Equal(["company.tax_id", "external_account"], snapshot.CurrentlyDue);
        Assert.Equal(
            ["company.tax_id", "external_account"],
            StripeConnectAccountState.GetActionableRequirements(snapshot));
    }

    [Fact]
    public void BuildRestrictions_UsesStripeReasonAndHumanReadableRequirement()
    {
        var snapshot = new StripeConnectAccountStateSnapshot
        {
            CurrentlyDue = ["person_123.verification.document"],
            Errors =
            [
                new StripeConnectRequirementErrorSnapshot
                {
                    Code = "verification_document_not_readable",
                    Requirement = "person_123.verification.document",
                    Reason = "The image supplied isn't readable."
                }
            ]
        };

        var restriction = Assert.Single(
            StripeConnectAccountState.BuildRestrictions(snapshot, true, false, false),
            item => item.Code == "verification_document_not_readable");

        Assert.Equal("Account representative identity document", restriction.Title);
        Assert.Equal("The image supplied isn't readable.", restriction.Message);
        Assert.True(restriction.ActionRequired);
        Assert.Equal("Error", restriction.Severity);
    }

    [Fact]
    public void BuildRestrictions_PendingVerification_DoesNotDemandAction()
    {
        var snapshot = new StripeConnectAccountStateSnapshot
        {
            DisabledReason = "requirements.pending_verification",
            PendingVerification = ["person_123.verification.document"]
        };

        var restrictions = StripeConnectAccountState.BuildRestrictions(
            snapshot,
            detailsSubmitted: true,
            chargesEnabled: true,
            payoutsEnabled: true);

        Assert.Contains(restrictions, item =>
            item.Code == "requirements.pending_verification" &&
            !item.ActionRequired);
        Assert.Contains(restrictions, item =>
            item.Code == "PendingVerification" &&
            item.Title == "Account representative identity document" &&
            !item.ActionRequired);
    }

    [Fact]
    public void Read_VersionedSnapshot_RestoresDeadlineAndErrors()
    {
        var deadline = new DateTime(2026, 8, 1, 2, 30, 0, DateTimeKind.Utc);
        var json = JsonSerializer.Serialize(new StripeConnectAccountStateSnapshot
        {
            CurrentDeadline = deadline,
            PastDue = ["external_account"],
            Errors =
            [
                new StripeConnectRequirementErrorSnapshot
                {
                    Code = "information_missing",
                    Requirement = "external_account",
                    Reason = "Add a payout bank account."
                }
            ]
        });

        var snapshot = StripeConnectAccountState.Read(json);

        Assert.Equal(deadline, snapshot.CurrentDeadline);
        Assert.Equal(["external_account"], snapshot.PastDue);
        Assert.Equal("information_missing", Assert.Single(snapshot.Errors).Code);
    }
}
