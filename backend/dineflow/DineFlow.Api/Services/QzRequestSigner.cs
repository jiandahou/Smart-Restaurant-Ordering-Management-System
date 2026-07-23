using System.Security.Cryptography;
using System.Text;

namespace DineFlow.Api.Services;

/// <summary>
/// Signs QZ Tray request payloads with the deployment's private key so the browser
/// client can present trusted, non-anonymous print requests. QZ Tray verifies the
/// signature against the certificate served by <c>GET /api/print/certificate</c>.
/// </summary>
public static class QzRequestSigner
{
    public static string Sign(string privateKeyPem, string data)
    {
        using var rsa = RSA.Create();
        rsa.ImportFromPem(privateKeyPem);

        var signature = rsa.SignData(
            Encoding.UTF8.GetBytes(data),
            HashAlgorithmName.SHA512,
            RSASignaturePadding.Pkcs1);

        return Convert.ToBase64String(signature);
    }
}
