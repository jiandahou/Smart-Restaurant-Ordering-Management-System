using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using DineFlow.Api.Authorization;
using DineFlow.Api.Controllers;
using DineFlow.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Xunit;

namespace DineFlow.Tests;

public class QzRequestSignerTests
{
    [Fact]
    public void Sign_ProducesVerifiableSha512Pkcs1Signature()
    {
        using var rsa = RSA.Create(2048);
        var privateKeyPem = rsa.ExportPkcs8PrivateKeyPem();

        var signatureBase64 = QzRequestSigner.Sign(privateKeyPem, "hello-qz");
        var signature = Convert.FromBase64String(signatureBase64);

        Assert.True(rsa.VerifyData(
            Encoding.UTF8.GetBytes("hello-qz"),
            signature,
            HashAlgorithmName.SHA512,
            RSASignaturePadding.Pkcs1));
    }

    [Fact]
    public void Sign_DifferentPayloads_ProduceDifferentSignatures()
    {
        using var rsa = RSA.Create(2048);
        var privateKeyPem = rsa.ExportPkcs8PrivateKeyPem();

        Assert.NotEqual(
            QzRequestSigner.Sign(privateKeyPem, "payload-a"),
            QzRequestSigner.Sign(privateKeyPem, "payload-b"));
    }
}

/// <summary>
/// Guards the authorization contract of <see cref="PrintSigningController"/>: the
/// certificate is public, but signing must stay restricted to staff accounts.
/// </summary>
public class PrintSigningAuthorizationContractTests
{
    [Fact]
    public void GetCertificate_IsAnonymous()
    {
        var method = typeof(PrintSigningController).GetMethod(
            nameof(PrintSigningController.GetCertificate), BindingFlags.Public | BindingFlags.Instance)!;

        Assert.NotNull(method.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public void SignRequest_RequiresStaffPolicy()
    {
        var method = typeof(PrintSigningController).GetMethod(
            nameof(PrintSigningController.SignRequest), BindingFlags.Public | BindingFlags.Instance)!;
        var authorize = method.GetCustomAttribute<AuthorizeAttribute>();

        Assert.NotNull(authorize);
        Assert.Equal(AuthorizationPolicies.StaffApi, authorize!.Policy);
    }
}
