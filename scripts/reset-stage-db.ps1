param(
    [string]$HostName = "dineflow-postgres-staging.chysimg0snwm.ap-southeast-2.rds.amazonaws.com",
    [int]$Port = 5432,
    [string]$Database = "dineflow_db",
    [string]$Username = "dineflow_user",
    [string]$SqlFile = (Join-Path $PSScriptRoot "reset-stage-public-schema.sql"),
    [switch]$SkipConfirmation
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SqlFile)) {
    throw "SQL file not found: $SqlFile"
}

if (-not $env:STAGE_RDS_PASSWORD) {
    throw 'Set the STAGE_RDS_PASSWORD environment variable in this terminal before running the script.'
}

if (-not $SkipConfirmation) {
    $confirmation = Read-Host "This will DROP SCHEMA public CASCADE on $Database at $HostName. Type RESET to continue"
    if ($confirmation -ne 'RESET') {
        throw 'Aborted by user.'
    }
}

$resolvedSqlFile = (Resolve-Path -LiteralPath $SqlFile).Path
$mountedSqlFile = $resolvedSqlFile -replace '\\', '/'
$mountedSqlFile = $mountedSqlFile -replace '^([A-Za-z]):', '/$1'

$connectionString = "host=$HostName port=$Port dbname=$Database user=$Username sslmode=require"

$null = docker info 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'Docker daemon is not running. Start Docker Desktop and retry.'
}

$dockerArgs = @(
    'run'
    '--rm'
    '-v'
    "${mountedSqlFile}:/work/reset-stage-public-schema.sql:ro"
    '-e'
    "PGPASSWORD=$($env:STAGE_RDS_PASSWORD)"
    'postgres:16'
    'psql'
    $connectionString
    '-v'
    'ON_ERROR_STOP=1'
    '-f'
    '/work/reset-stage-public-schema.sql'
)

& docker @dockerArgs