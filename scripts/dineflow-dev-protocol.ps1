param(
    [Parameter(Mandatory = $true)]
    [string]$Uri
)

$ErrorActionPreference = 'Stop'

if ($Uri.TrimEnd('/') -ne 'dineflow-dev://stripe-forward') {
    Write-Error 'Unsupported DineFlow development command.'
    exit 2
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$forwardTo = 'http://localhost:5000/api/payments/stripe/webhook'
$environmentFile = Join-Path $repositoryRoot '.env'

if (Test-Path -LiteralPath $environmentFile) {
    $configuredForwardTo = Get-Content -Encoding UTF8 -LiteralPath $environmentFile |
        Where-Object { $_ -match '^STRIPE_FORWARD_TO_URL=(.+)$' } |
        Select-Object -First 1

    if ($configuredForwardTo -match '^STRIPE_FORWARD_TO_URL=(.+)$') {
        $forwardTo = $Matches[1].Trim().Trim('"').Trim("'")
    }
}

$forwardUri = $null
if (-not [Uri]::TryCreate($forwardTo, [UriKind]::Absolute, [ref]$forwardUri) -or
    $forwardUri.Scheme -notin @('http', 'https')) {
    Write-Error 'STRIPE_FORWARD_TO_URL must be an absolute HTTP or HTTPS URL.'
    exit 3
}

$stripeCommand = "stripe listen --forward-to '$($forwardUri.AbsoluteUri)'"
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit',
    '-NoProfile',
    '-Command',
    $stripeCommand
) -WindowStyle Normal
