<#
.SYNOPSIS
Runs an independent Windows Bluetooth SPP/serial stability test for the HS-M80.

.DESCRIPTION
This tool talks directly to a Windows COM port through System.IO.Ports.SerialPort.
It does not use the DineFlow website, QZ Tray, or a Windows printer driver.

The tool continuously writes an NDJSON recovery log and produces a final JSON
report. Press:
  Q - stop and save the report
  R - mark that the printer was just restarted/power-cycled
  S - send one non-printing ESC/POS real-time status query
  T - send one small TEST ticket (only when -EnablePrintTest was supplied)

.EXAMPLE
.\hs-m80-spp-diagnostics.ps1 -PortName COM4 -Mode KeepOpen -DurationMinutes 120

.EXAMPLE
.\hs-m80-spp-diagnostics.ps1 -PortName COM4 -Mode Cycle -CycleIntervalSeconds 30 -DurationMinutes 120

.EXAMPLE
.\hs-m80-spp-diagnostics.ps1 -PortName COM4 -Mode KeepOpen -EnableStatusProbe -StatusProbeIntervalSeconds 30 -DurationMinutes 120

.EXAMPLE
.\hs-m80-spp-diagnostics.ps1 -PortName COM4 -Mode KeepOpen -EnablePrintTest -PrintIntervalMinutes 5 -DurationMinutes 30
#>

[CmdletBinding()]
param(
    [ValidatePattern('^COM[1-9][0-9]*$')]
    [string]$PortName = 'COM4',

    [ValidateSet('KeepOpen', 'Cycle')]
    [string]$Mode = 'KeepOpen',

    [ValidateRange(1, 3600)]
    [int]$PollIntervalSeconds = 5,

    [ValidateRange(1, 3600)]
    [int]$ReconnectIntervalSeconds = 5,

    [ValidateRange(1, 3600)]
    [int]$CycleIntervalSeconds = 30,

    [ValidateRange(0, 10080)]
    [double]$DurationMinutes = 120,

    [ValidateRange(0, 604800)]
    [int]$DurationSeconds = 0,

    [Alias('OpenTimeoutMilliseconds')]
    [ValidateRange(300, 60000)]
    [int]$OpenWarningThresholdMilliseconds = 10000,

    [ValidateRange(100, 60000)]
    [int]$ReadTimeoutMilliseconds = 1200,

    [ValidateRange(100, 60000)]
    [int]$WriteTimeoutMilliseconds = 5000,

    [ValidateRange(1, 1000000)]
    [int]$BaudRate = 9600,

    [switch]$EnableStatusProbe,

    [ValidateRange(5, 86400)]
    [int]$StatusProbeIntervalSeconds = 30,

    [switch]$EnablePrintTest,

    [ValidateRange(1, 1440)]
    [int]$PrintIntervalMinutes = 5,

    [string]$PrinterQueueName = 'POS80 Printer(2)',

    [switch]$AllowQzRunning,

    [switch]$AllowQueuedPrintJobs,

    [switch]$AllowUnpausedPrinterQueue,

    [switch]$AllowPrinterQueueCheckFailure,

    [switch]$DryRun,

    [string]$OutputDirectory,

    [switch]$VerboseEvents
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ToolVersion = '1.0.0'
$script:StartedAt = Get-Date
$script:StartedAtUtc = $script:StartedAt.ToUniversalTime()
$script:StopRequested = $false
$script:SerialPort = $null
$script:EventSequence = 0
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:LastPortPresence = $null
$script:LastPortNames = @()
$script:LastBthRecordId = 0L
$script:LastBthPollAt = [datetime]::MinValue
$script:NextReconnectAt = $script:StartedAt
$script:NextCycleAt = $script:StartedAt
$script:NextStatusProbeAt = if ($EnableStatusProbe) { $script:StartedAt.AddSeconds($StatusProbeIntervalSeconds) } else { [datetime]::MaxValue }
$script:NextPrintAt = if ($EnablePrintTest) { $script:StartedAt.AddMinutes($PrintIntervalMinutes) } else { [datetime]::MaxValue }
$script:PrintTestCounter = 0
$script:OpenAttemptCount = 0
$script:OpenSuccessCount = 0
$script:OpenFailureCount = 0
$script:CloseFailureCount = 0
$script:StatusProbeCount = 0
$script:StatusResponseCount = 0
$script:StatusNoResponseCount = 0
$script:PrintTestCount = 0
$script:PrintTestFailureCount = 0
$script:IncidentCount = 0
$script:RecoveryCount = 0
$script:RecoveryAfterRestartMarkerCount = 0
$script:IncidentActive = $false
$script:IncidentStartedAt = $null
$script:IncidentClassification = $null
$script:LastRestartMarkerAt = $null
$script:FatalError = $null

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'
    if (Test-Path -LiteralPath $downloads) {
        $OutputDirectory = Join-Path $downloads 'DineFlow-SPP-Diagnostics'
    }
    else {
        $OutputDirectory = Join-Path $PSScriptRoot 'spp-diagnostics-output'
    }
}

$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$runId = '{0}-{1}' -f $script:StartedAt.ToString('yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$script:PartialLogPath = Join-Path $OutputDirectory "hs-m80-spp-$runId.ndjson"
$script:ReportPath = Join-Path $OutputDirectory "hs-m80-spp-$runId.json"

function Write-ConsoleStatus {
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )

    $timestamp = (Get-Date).ToString('HH:mm:ss')
    Write-Host "[$timestamp] $Message" -ForegroundColor $Color
}

function ConvertTo-SerializableValue {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [datetime]) {
        return $Value.ToUniversalTime().ToString('o')
    }

    return $Value
}

function Write-DiagnosticEvent {
    param(
        [Parameter(Mandatory)]
        [string]$Event,

        [hashtable]$Details = @{}
    )

    $script:EventSequence++
    $normalizedDetails = [ordered]@{}
    foreach ($key in $Details.Keys) {
        $normalizedDetails[$key] = ConvertTo-SerializableValue $Details[$key]
    }

    $entry = [ordered]@{
        sequence = $script:EventSequence
        atUtc = (Get-Date).ToUniversalTime().ToString('o')
        event = $Event
        details = $normalizedDetails
    }

    $line = $entry | ConvertTo-Json -Compress -Depth 12
    [System.IO.File]::AppendAllText(
        $script:PartialLogPath,
        $line + [Environment]::NewLine,
        $script:Utf8NoBom
    )

    if ($VerboseEvents) {
        Write-ConsoleStatus "$Event $($normalizedDetails | ConvertTo-Json -Compress -Depth 4)" ([ConsoleColor]::DarkGray)
    }
}

function Get-Win32Code {
    param(
        [Parameter(Mandatory)]
        [System.Exception]$Exception
    )

    return ($Exception.HResult -band 0xFFFF)
}

function Get-ExceptionClassification {
    param(
        [Parameter(Mandatory)]
        [System.Exception]$Exception
    )

    $chain = @()
    $cursor = $Exception
    while ($null -ne $cursor) {
        if ($cursor.Data.Contains('DineFlowClassification')) {
            return [string]$cursor.Data['DineFlowClassification']
        }
        $chain += $cursor
        $cursor = $cursor.InnerException
    }

    $codes = @($chain | ForEach-Object { Get-Win32Code $_ })
    $message = ($chain | ForEach-Object { [string]$_.Message }) -join ' | '

    if (@($chain | Where-Object { $_ -is [System.UnauthorizedAccessException] }).Count -gt 0 -or
        @($codes | Where-Object { $_ -in @(5, 32, 33) }).Count -gt 0 -or
        $message -match '(?i)access.*denied|port.*busy|being used by another process') {
        return 'PortBusyOrAccessDenied'
    }

    if (@($codes | Where-Object { $_ -in @(2, 3) }).Count -gt 0 -or $message -match '(?i)not found|does not exist') {
        return 'PortNotFound'
    }

    if (@($codes | Where-Object { $_ -eq 87 }).Count -gt 0 -or $message -match '(?i)incorrect parameter|invalid parameter') {
        return 'IncorrectSerialPort'
    }

    if (@($codes | Where-Object { $_ -in @(121, 1460) }).Count -gt 0 -or
        @($chain | Where-Object { $_ -is [System.TimeoutException] }).Count -gt 0 -or
        $message -match '(?i)timeout|timed out') {
        return 'Timeout'
    }

    if (@($codes | Where-Object { $_ -in @(995, 1167, 1168) }).Count -gt 0 -or
        $message -match '(?i)not connected|device.*removed|element.*not found|找不到元素') {
        return 'DeviceDisconnected'
    }

    if (@($chain | Where-Object { $_ -is [System.IO.IOException] }).Count -gt 0) {
        return 'SerialIOException'
    }

    return 'UnexpectedError'
}

function Stop-Preflight {
    param(
        [Parameter(Mandatory)]
        [string]$Message
    )

    $exception = New-Object System.InvalidOperationException($Message)
    $exception.Data['DineFlowClassification'] = 'PreflightBlocked'
    throw $exception
}

function Get-ExceptionDetails {
    param(
        [Parameter(Mandatory)]
        [System.Exception]$Exception
    )

    $chain = @()
    $cursor = $Exception
    while ($null -ne $cursor) {
        $chain += [ordered]@{
            exceptionType = $cursor.GetType().FullName
            message = $cursor.Message
            hResult = ('0x{0:X8}' -f ($cursor.HResult -band 0xFFFFFFFFL))
            win32Code = Get-Win32Code $cursor
        }
        $cursor = $cursor.InnerException
    }

    $root = $Exception
    while ($null -ne $root.InnerException) {
        $root = $root.InnerException
    }

    return @{
        classification = Get-ExceptionClassification $Exception
        exceptionType = $Exception.GetType().FullName
        message = $Exception.Message
        hResult = ('0x{0:X8}' -f ($Exception.HResult -band 0xFFFFFFFFL))
        win32Code = Get-Win32Code $Exception
        rootExceptionType = $root.GetType().FullName
        rootMessage = $root.Message
        rootHResult = ('0x{0:X8}' -f ($root.HResult -band 0xFFFFFFFFL))
        rootWin32Code = Get-Win32Code $root
        exceptionChain = $chain
    }
}

function Register-IncidentFailure {
    param(
        [Parameter(Mandatory)]
        [string]$Classification,

        [Parameter(Mandatory)]
        [string]$Source
    )

    if (-not $script:IncidentActive) {
        $script:IncidentActive = $true
        $script:IncidentStartedAt = Get-Date
        $script:IncidentClassification = $Classification
        $script:IncidentCount++

        Write-DiagnosticEvent 'incident_started' @{
            incidentNumber = $script:IncidentCount
            classification = $Classification
            source = $Source
        }

        Write-ConsoleStatus "Incident started: $Classification ($Source)" ([ConsoleColor]::Red)
    }
}

function Register-IncidentRecovery {
    param(
        [Parameter(Mandatory)]
        [string]$Source
    )

    if (-not $script:IncidentActive) {
        return
    }

    $now = Get-Date
    $durationMs = [math]::Round(($now - $script:IncidentStartedAt).TotalMilliseconds)
    $restartMarkerDuringIncident = $null -ne $script:LastRestartMarkerAt -and $script:LastRestartMarkerAt -ge $script:IncidentStartedAt

    $script:RecoveryCount++
    if ($restartMarkerDuringIncident) {
        $script:RecoveryAfterRestartMarkerCount++
    }

    Write-DiagnosticEvent 'incident_recovered' @{
        incidentNumber = $script:IncidentCount
        originalClassification = $script:IncidentClassification
        source = $Source
        durationMs = $durationMs
        printerRestartMarkedDuringIncident = $restartMarkerDuringIncident
        lastRestartMarkerAtUtc = $script:LastRestartMarkerAt
    }

    Write-ConsoleStatus "Connection recovered after $durationMs ms; restart marker=$restartMarkerDuringIncident" ([ConsoleColor]::Green)

    $script:IncidentActive = $false
    $script:IncidentStartedAt = $null
    $script:IncidentClassification = $null
}

function Get-AvailablePortNames {
    try {
        return @([System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object)
    }
    catch {
        Write-DiagnosticEvent 'port_enumeration_failed' (Get-ExceptionDetails $_.Exception)
        return @()
    }
}

function Get-QzProcessSnapshot {
    $processes = @()
    try {
        $processes = @(
            Get-Process -ErrorAction SilentlyContinue |
                Where-Object { $_.ProcessName -match '(?i)^qz([.-]?tray)?$|^qz-tray' } |
                ForEach-Object {
                    [ordered]@{
                        processName = $_.ProcessName
                        id = $_.Id
                        path = try { $_.Path } catch { $null }
                    }
                }
        )
    }
    catch {
        Write-DiagnosticEvent 'qz_process_check_failed' (Get-ExceptionDetails $_.Exception)
    }

    return $processes
}

function Get-PrinterQueueSnapshot {
    $result = [ordered]@{
        name = $PrinterQueueName
        querySucceeded = $false
        exists = $false
        driverName = $null
        portName = $null
        printerStatus = $null
        jobCount = 0
        jobs = @()
        queryError = $null
    }

    try {
        $printer = @(
            Get-Printer -ErrorAction Stop |
                Where-Object { $_.Name -eq $PrinterQueueName }
        ) | Select-Object -First 1

        $result.querySucceeded = $true
        if ($null -eq $printer) {
            return $result
        }

        $result.exists = $true
        $result.driverName = $printer.DriverName
        $result.portName = $printer.PortName
        $result.printerStatus = [string]$printer.PrinterStatus

        $jobs = @(
            Get-PrintJob -PrinterName $PrinterQueueName -ErrorAction SilentlyContinue |
                ForEach-Object {
                    [ordered]@{
                        id = $_.Id
                        documentName = $_.DocumentName
                        jobStatus = [string]$_.JobStatus
                        submittedTime = if ($null -ne $_.SubmittedTime) { $_.SubmittedTime.ToUniversalTime().ToString('o') } else { $null }
                        size = $_.Size
                    }
                }
        )
        $result.jobCount = $jobs.Count
        $result.jobs = $jobs
    }
    catch {
        $result.queryError = $_.Exception.Message
    }

    return $result
}

function Get-BluetoothAdapterSnapshot {
    $adapters = @()

    try {
        $devices = @(
            Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue |
                Where-Object { $_.InstanceId -match '(?i)^(USB|PCI)\\' }
        )

        foreach ($device in $devices) {
            $properties = @(Get-PnpDeviceProperty -InstanceId $device.InstanceId -ErrorAction SilentlyContinue)
            $adapters += [ordered]@{
                friendlyName = $device.FriendlyName
                status = [string]$device.Status
                instanceId = $device.InstanceId
                manufacturer = ($properties | Where-Object KeyName -eq 'DEVPKEY_Device_Manufacturer' | Select-Object -First 1).Data
                driverProvider = ($properties | Where-Object KeyName -eq 'DEVPKEY_Device_DriverProvider' | Select-Object -First 1).Data
                driverVersion = ($properties | Where-Object KeyName -eq 'DEVPKEY_Device_DriverVersion' | Select-Object -First 1).Data
                driverDate = ConvertTo-SerializableValue (($properties | Where-Object KeyName -eq 'DEVPKEY_Device_DriverDate' | Select-Object -First 1).Data)
                problemCode = ($properties | Where-Object KeyName -eq 'DEVPKEY_Device_ProblemCode' | Select-Object -First 1).Data
            }
        }
    }
    catch {
        return @(
            [ordered]@{
                queryError = $_.Exception.Message
            }
        )
    }

    return $adapters
}

function Get-RecentBthUsbEvents {
    param(
        [int]$MaxEvents = 20,
        [datetime]$StartTime = (Get-Date).AddDays(-2)
    )

    try {
        return @(
            Get-WinEvent -FilterHashtable @{
                LogName = 'System'
                ProviderName = 'BTHUSB'
                StartTime = $StartTime
            } -ErrorAction Stop |
                Sort-Object RecordId -Descending |
                Select-Object -First $MaxEvents |
                ForEach-Object {
                    [ordered]@{
                        recordId = $_.RecordId
                        atUtc = $_.TimeCreated.ToUniversalTime().ToString('o')
                        id = $_.Id
                        level = $_.LevelDisplayName
                        message = $_.Message
                    }
                }
        )
    }
    catch {
        return @(
            [ordered]@{
                queryError = $_.Exception.Message
            }
        )
    }
}

function Initialize-BthUsbCursor {
    try {
        $latest = Get-WinEvent -FilterHashtable @{
            LogName = 'System'
            ProviderName = 'BTHUSB'
        } -MaxEvents 1 -ErrorAction Stop

        if ($null -ne $latest) {
            $script:LastBthRecordId = [long]$latest.RecordId
        }
    }
    catch {
        Write-DiagnosticEvent 'bthusb_cursor_initialization_failed' (Get-ExceptionDetails $_.Exception)
    }
}

function Import-NewBthUsbEvents {
    $now = Get-Date
    if (($now - $script:LastBthPollAt).TotalSeconds -lt 10) {
        return
    }
    $script:LastBthPollAt = $now

    try {
        $events = @(
            Get-WinEvent -FilterHashtable @{
                LogName = 'System'
                ProviderName = 'BTHUSB'
                StartTime = $script:StartedAt.AddSeconds(-2)
            } -ErrorAction Stop |
                Where-Object { [long]$_.RecordId -gt $script:LastBthRecordId } |
                Sort-Object RecordId
        )

        foreach ($event in $events) {
            Write-DiagnosticEvent 'windows_bthusb_event' @{
                recordId = [long]$event.RecordId
                eventId = $event.Id
                level = $event.LevelDisplayName
                message = $event.Message
                eventAtUtc = $event.TimeCreated
            }
            $script:LastBthRecordId = [long]$event.RecordId
            Write-ConsoleStatus "Windows BTHUSB event $($event.Id): $($event.Message)" ([ConsoleColor]::Yellow)
        }
    }
    catch {
        if ($_.Exception.Message -match '(?i)no events were found|no matching events|找不到任何与指定的选择条件匹配的事件') {
            return
        }
        Write-DiagnosticEvent 'bthusb_query_failed' (Get-ExceptionDetails $_.Exception)
    }
}

function New-DiagnosticSerialPort {
    $port = New-Object System.IO.Ports.SerialPort
    $port.PortName = $PortName
    $port.BaudRate = $BaudRate
    $port.Parity = [System.IO.Ports.Parity]::None
    $port.DataBits = 8
    $port.StopBits = [System.IO.Ports.StopBits]::One
    $port.Handshake = [System.IO.Ports.Handshake]::None
    $port.ReadTimeout = $ReadTimeoutMilliseconds
    $port.WriteTimeout = $WriteTimeoutMilliseconds
    $port.DtrEnable = $false
    $port.RtsEnable = $false
    return $port
}

function Close-DiagnosticSerialPort {
    param(
        [string]$Reason = 'unspecified'
    )

    if ($null -eq $script:SerialPort) {
        return
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if ($script:SerialPort.IsOpen) {
            $script:SerialPort.Close()
        }
        $stopwatch.Stop()
        Write-DiagnosticEvent 'serial_close_succeeded' @{
            portName = $PortName
            reason = $Reason
            durationMs = $stopwatch.ElapsedMilliseconds
        }
    }
    catch {
        $stopwatch.Stop()
        $script:CloseFailureCount++
        $details = Get-ExceptionDetails $_.Exception
        $details.portName = $PortName
        $details.reason = $Reason
        $details.durationMs = $stopwatch.ElapsedMilliseconds
        Write-DiagnosticEvent 'serial_close_failed' $details
        Register-IncidentFailure $details.classification 'close'
    }
    finally {
        try {
            $script:SerialPort.Dispose()
        }
        catch {
            Write-DiagnosticEvent 'serial_dispose_failed' (Get-ExceptionDetails $_.Exception)
        }
        $script:SerialPort = $null
    }
}

function Open-DiagnosticSerialPort {
    param(
        [string]$Reason = 'scheduled'
    )

    if ($DryRun) {
        return $false
    }

    if ($null -ne $script:SerialPort -and $script:SerialPort.IsOpen) {
        return $true
    }

    $script:OpenAttemptCount++
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    Write-DiagnosticEvent 'serial_open_started' @{
        portName = $PortName
        reason = $Reason
        attempt = $script:OpenAttemptCount
        warningThresholdMs = $OpenWarningThresholdMilliseconds
    }

    try {
        $script:SerialPort = New-DiagnosticSerialPort
        $script:SerialPort.Open()

        $stopwatch.Stop()
        $script:OpenSuccessCount++
        Write-DiagnosticEvent 'serial_open_succeeded' @{
            portName = $PortName
            reason = $Reason
            attempt = $script:OpenAttemptCount
            durationMs = $stopwatch.ElapsedMilliseconds
            exceededWarningThreshold = $stopwatch.ElapsedMilliseconds -gt $OpenWarningThresholdMilliseconds
        }
        Write-ConsoleStatus "$PortName opened in $($stopwatch.ElapsedMilliseconds) ms" ([ConsoleColor]::Green)
        Register-IncidentRecovery 'open'
        return $true
    }
    catch {
        $stopwatch.Stop()
        $script:OpenFailureCount++
        $details = Get-ExceptionDetails $_.Exception
        $details.portName = $PortName
        $details.reason = $Reason
        $details.attempt = $script:OpenAttemptCount
        $details.durationMs = $stopwatch.ElapsedMilliseconds
        Write-DiagnosticEvent 'serial_open_failed' $details
        Write-ConsoleStatus "$PortName open failed: $($details.classification) / $($details.message)" ([ConsoleColor]::Red)
        Register-IncidentFailure $details.classification 'open'
        Close-DiagnosticSerialPort 'open-failed-cleanup'
        return $false
    }
}

function Write-SerialBytes {
    param(
        [Parameter(Mandatory)]
        [byte[]]$Bytes,

        [Parameter(Mandatory)]
        [string]$Purpose
    )

    if ($null -eq $script:SerialPort -or -not $script:SerialPort.IsOpen) {
        Write-DiagnosticEvent 'serial_write_skipped' @{
            purpose = $Purpose
            reason = 'port-not-open'
            byteCount = $Bytes.Length
        }
        Register-IncidentFailure 'PortNotOpen' "write:$Purpose"
        return $false
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $script:SerialPort.Write($Bytes, 0, $Bytes.Length)
        $stopwatch.Stop()
        Write-DiagnosticEvent 'serial_write_succeeded' @{
            purpose = $Purpose
            byteCount = $Bytes.Length
            durationMs = $stopwatch.ElapsedMilliseconds
        }
        Register-IncidentRecovery "write:$Purpose"
        return $true
    }
    catch {
        $stopwatch.Stop()
        $details = Get-ExceptionDetails $_.Exception
        $details.purpose = $Purpose
        $details.byteCount = $Bytes.Length
        $details.durationMs = $stopwatch.ElapsedMilliseconds
        Write-DiagnosticEvent 'serial_write_failed' $details
        Write-ConsoleStatus "Serial write failed: $($details.classification) / $($details.message)" ([ConsoleColor]::Red)
        Register-IncidentFailure $details.classification "write:$Purpose"
        Close-DiagnosticSerialPort "write-failed:$Purpose"
        return $false
    }
}

function Invoke-StatusProbe {
    param(
        [string]$Reason = 'scheduled'
    )

    $script:StatusProbeCount++
    if ($null -eq $script:SerialPort -or -not $script:SerialPort.IsOpen) {
        if (-not (Open-DiagnosticSerialPort "status-probe:$Reason")) {
            return $false
        }
    }

    try {
        $script:SerialPort.DiscardInBuffer()
    }
    catch {
        Write-DiagnosticEvent 'serial_discard_input_failed' (Get-ExceptionDetails $_.Exception)
    }

    $query = [byte[]](0x10, 0x04, 0x01)
    if (-not (Write-SerialBytes $query "status-probe:$Reason")) {
        return $false
    }

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $script:SerialPort.ReadByte()
        $stopwatch.Stop()
        $script:StatusResponseCount++
        Write-DiagnosticEvent 'status_probe_response' @{
            reason = $Reason
            responseDecimal = $response
            responseHex = ('0x{0:X2}' -f $response)
            durationMs = $stopwatch.ElapsedMilliseconds
        }
        Write-ConsoleStatus "Status response: $response (0x$('{0:X2}' -f $response))" ([ConsoleColor]::Cyan)
        Register-IncidentRecovery 'status-response'
        return $true
    }
    catch [System.TimeoutException] {
        $stopwatch.Stop()
        $script:StatusNoResponseCount++
        Write-DiagnosticEvent 'status_probe_no_response' @{
            reason = $Reason
            durationMs = $stopwatch.ElapsedMilliseconds
            note = 'Some ESC/POS-compatible printers do not return real-time status. This alone is not treated as a disconnect.'
        }
        Write-ConsoleStatus 'Status query was written, but no byte was returned. This alone is not treated as a disconnect.' ([ConsoleColor]::DarkYellow)
        return $true
    }
    catch {
        $stopwatch.Stop()
        $details = Get-ExceptionDetails $_.Exception
        $details.reason = $Reason
        $details.durationMs = $stopwatch.ElapsedMilliseconds
        Write-DiagnosticEvent 'status_probe_read_failed' $details
        Register-IncidentFailure $details.classification 'status-read'
        Close-DiagnosticSerialPort 'status-read-failed'
        return $false
    }
}

function Invoke-PrintTest {
    param(
        [string]$Reason = 'scheduled'
    )

    if (-not $EnablePrintTest) {
        Write-ConsoleStatus 'Print testing is disabled. Restart with -EnablePrintTest to allow paper output.' ([ConsoleColor]::Yellow)
        Write-DiagnosticEvent 'print_test_blocked' @{
            reason = $Reason
            enablePrintTest = $false
        }
        return $false
    }

    if ($null -eq $script:SerialPort -or -not $script:SerialPort.IsOpen) {
        if (-not (Open-DiagnosticSerialPort "print-test:$Reason")) {
            $script:PrintTestFailureCount++
            return $false
        }
    }

    $script:PrintTestCounter++
    $text = "SPP TEST $($script:PrintTestCounter)  $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
    $initialize = [byte[]](0x1B, 0x40)
    $body = [System.Text.Encoding]::ASCII.GetBytes($text)
    $feed = [byte[]](0x0A, 0x0A, 0x0A)
    $payload = New-Object byte[] ($initialize.Length + $body.Length + $feed.Length)
    [Array]::Copy($initialize, 0, $payload, 0, $initialize.Length)
    [Array]::Copy($body, 0, $payload, $initialize.Length, $body.Length)
    [Array]::Copy($feed, 0, $payload, $initialize.Length + $body.Length, $feed.Length)

    if (Write-SerialBytes $payload "print-test:$Reason") {
        $script:PrintTestCount++
        Write-DiagnosticEvent 'print_test_sent' @{
            reason = $Reason
            testNumber = $script:PrintTestCounter
            text = $text
            byteCount = $payload.Length
        }
        Write-ConsoleStatus "Test ticket sent: $text" ([ConsoleColor]::Cyan)
        return $true
    }

    $script:PrintTestFailureCount++
    return $false
}

function Read-InteractiveCommands {
    try {
        if ([Console]::IsInputRedirected) {
            return
        }

        while ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                'Q' {
                    $script:StopRequested = $true
                    Write-DiagnosticEvent 'user_stop_requested' @{}
                    Write-ConsoleStatus 'Q received. Stopping and saving the report...' ([ConsoleColor]::Yellow)
                }
                'R' {
                    $script:LastRestartMarkerAt = Get-Date
                    Write-DiagnosticEvent 'printer_restart_marker' @{
                        portOpen = $null -ne $script:SerialPort -and $script:SerialPort.IsOpen
                        incidentActive = $script:IncidentActive
                    }
                    Write-ConsoleStatus 'Printer restart marker recorded. Recovery will be correlated with this marker.' ([ConsoleColor]::Magenta)
                    Close-DiagnosticSerialPort 'printer-restart-marker'
                    $script:NextReconnectAt = Get-Date
                    $script:NextCycleAt = Get-Date
                }
                'S' {
                    Write-DiagnosticEvent 'manual_status_probe_requested' @{}
                    $null = Invoke-StatusProbe 'manual-key'
                }
                'T' {
                    Write-DiagnosticEvent 'manual_print_test_requested' @{}
                    $null = Invoke-PrintTest 'manual-key'
                }
            }
        }
    }
    catch {
        Write-DiagnosticEvent 'interactive_input_failed' (Get-ExceptionDetails $_.Exception)
    }
}

function Invoke-PortPoll {
    $portNames = Get-AvailablePortNames
    $present = $portNames -contains $PortName
    $open = $null -ne $script:SerialPort -and $script:SerialPort.IsOpen
    $namesChanged = (($script:LastPortNames -join '|') -ne ($portNames -join '|'))

    Write-DiagnosticEvent 'port_poll' @{
        portName = $PortName
        present = $present
        serialObjectOpen = $open
        availablePorts = $portNames
    }

    if ($null -eq $script:LastPortPresence -or $script:LastPortPresence -ne $present -or $namesChanged) {
        Write-DiagnosticEvent 'port_presence_changed' @{
            portName = $PortName
            previousPresent = $script:LastPortPresence
            present = $present
            availablePorts = $portNames
        }

        if ($present) {
            Write-ConsoleStatus "$PortName is present. Available ports: $($portNames -join ', ')" ([ConsoleColor]::Green)
        }
        else {
            Write-ConsoleStatus "$PortName is absent. Available ports: $($portNames -join ', ')" ([ConsoleColor]::Red)
            Register-IncidentFailure 'PortNotFound' 'port-poll'
            Close-DiagnosticSerialPort 'port-disappeared'
        }
    }

    $script:LastPortPresence = $present
    $script:LastPortNames = $portNames
    return $present
}

function Invoke-ScheduledWork {
    param(
        [bool]$PortPresent
    )

    if ($DryRun) {
        return
    }

    $now = Get-Date

    if ($Mode -eq 'KeepOpen') {
        $open = $null -ne $script:SerialPort -and $script:SerialPort.IsOpen
        if ($PortPresent -and -not $open -and $now -ge $script:NextReconnectAt) {
            $null = Open-DiagnosticSerialPort 'keep-open-reconnect'
            $script:NextReconnectAt = (Get-Date).AddSeconds($ReconnectIntervalSeconds)
        }
    }
    elseif ($Mode -eq 'Cycle' -and $now -ge $script:NextCycleAt) {
        Close-DiagnosticSerialPort 'cycle-before-open'
        if ($PortPresent -and (Open-DiagnosticSerialPort 'cycle')) {
            if ($EnableStatusProbe) {
                $null = Invoke-StatusProbe 'cycle'
            }
            if ($EnablePrintTest -and $now -ge $script:NextPrintAt) {
                $null = Invoke-PrintTest 'cycle'
                $script:NextPrintAt = (Get-Date).AddMinutes($PrintIntervalMinutes)
            }
            Close-DiagnosticSerialPort 'cycle-complete'
        }
        elseif (-not $PortPresent) {
            Register-IncidentFailure 'PortNotFound' 'cycle'
        }
        $script:NextCycleAt = (Get-Date).AddSeconds($CycleIntervalSeconds)
    }

    if ($Mode -eq 'KeepOpen' -and $EnableStatusProbe -and $now -ge $script:NextStatusProbeAt) {
        $null = Invoke-StatusProbe 'scheduled'
        $script:NextStatusProbeAt = (Get-Date).AddSeconds($StatusProbeIntervalSeconds)
    }

    if ($Mode -eq 'KeepOpen' -and $EnablePrintTest -and $now -ge $script:NextPrintAt) {
        $null = Invoke-PrintTest 'scheduled'
        $script:NextPrintAt = (Get-Date).AddMinutes($PrintIntervalMinutes)
    }
}

function Test-DurationReached {
    $elapsed = (Get-Date) - $script:StartedAt

    if ($DurationSeconds -gt 0) {
        return $elapsed.TotalSeconds -ge $DurationSeconds
    }

    if ($DurationMinutes -gt 0) {
        return $elapsed.TotalMinutes -ge $DurationMinutes
    }

    return $false
}

function Read-EventLogFile {
    $events = @()
    if (-not (Test-Path -LiteralPath $script:PartialLogPath)) {
        return $events
    }

    foreach ($line in Get-Content -LiteralPath $script:PartialLogPath -Encoding UTF8) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }
        try {
            $events += ($line | ConvertFrom-Json)
        }
        catch {
            $events += [pscustomobject]@{
                sequence = $null
                atUtc = (Get-Date).ToUniversalTime().ToString('o')
                event = 'partial_log_parse_failed'
                details = [pscustomobject]@{
                    message = $_.Exception.Message
                    rawLine = $line
                }
            }
        }
    }

    return $events
}

function Save-FinalReport {
    param(
        $InitialState,
        $EnvironmentSnapshot
    )

    $endedAt = Get-Date
    $events = @(Read-EventLogFile)
    $spontaneousRecoveries = [math]::Max(0, $script:RecoveryCount - $script:RecoveryAfterRestartMarkerCount)

    $restartAssessment = if ($script:RecoveryAfterRestartMarkerCount -gt 0 -and $spontaneousRecoveries -eq 0) {
        'Recovery was only observed after a user-marked printer restart in this run.'
    }
    elseif ($script:RecoveryAfterRestartMarkerCount -gt 0 -and $spontaneousRecoveries -gt 0) {
        'Both spontaneous recovery and recovery after a user-marked printer restart were observed.'
    }
    elseif ($script:RecoveryCount -gt 0) {
        'Recovery was observed without a printer restart marker.'
    }
    elseif ($script:IncidentCount -gt 0) {
        'At least one incident remained unrecovered during this run.'
    }
    else {
        'No connection incident was observed during this run.'
    }

    $report = [ordered]@{
        schemaVersion = 1
        tool = [ordered]@{
            name = 'DineFlow HS-M80 SPP Diagnostics'
            version = $script:ToolVersion
        }
        runId = $runId
        startedAtUtc = $script:StartedAtUtc.ToString('o')
        endedAtUtc = $endedAt.ToUniversalTime().ToString('o')
        durationSeconds = [math]::Round(($endedAt - $script:StartedAt).TotalSeconds, 3)
        configuration = [ordered]@{
            portName = $PortName
            mode = $Mode
            pollIntervalSeconds = $PollIntervalSeconds
            reconnectIntervalSeconds = $ReconnectIntervalSeconds
            cycleIntervalSeconds = $CycleIntervalSeconds
            durationMinutes = $DurationMinutes
            durationSecondsOverride = $DurationSeconds
            baudRate = $BaudRate
            dataBits = 8
            stopBits = 1
            parity = 'None'
            handshake = 'None'
            openWarningThresholdMilliseconds = $OpenWarningThresholdMilliseconds
            readTimeoutMilliseconds = $ReadTimeoutMilliseconds
            writeTimeoutMilliseconds = $WriteTimeoutMilliseconds
            statusProbeEnabled = [bool]$EnableStatusProbe
            statusProbeIntervalSeconds = $StatusProbeIntervalSeconds
            printTestEnabled = [bool]$EnablePrintTest
            printIntervalMinutes = $PrintIntervalMinutes
            printerQueueName = $PrinterQueueName
            dryRun = [bool]$DryRun
            allowQzRunning = [bool]$AllowQzRunning
            allowQueuedPrintJobs = [bool]$AllowQueuedPrintJobs
            allowUnpausedPrinterQueue = [bool]$AllowUnpausedPrinterQueue
            allowPrinterQueueCheckFailure = [bool]$AllowPrinterQueueCheckFailure
        }
        environment = $EnvironmentSnapshot
        initialState = $InitialState
        finalState = [ordered]@{
            availablePorts = @(Get-AvailablePortNames)
            printerQueue = Get-PrinterQueueSnapshot
            qzProcesses = @(Get-QzProcessSnapshot)
            recentBthUsbEvents = @(Get-RecentBthUsbEvents -MaxEvents 30 -StartTime $script:StartedAt.AddMinutes(-1))
        }
        summary = [ordered]@{
            eventCount = $events.Count
            openAttempts = $script:OpenAttemptCount
            openSuccesses = $script:OpenSuccessCount
            openFailures = $script:OpenFailureCount
            closeFailures = $script:CloseFailureCount
            statusProbes = $script:StatusProbeCount
            statusResponses = $script:StatusResponseCount
            statusNoResponses = $script:StatusNoResponseCount
            printTestsSent = $script:PrintTestCount
            printTestFailures = $script:PrintTestFailureCount
            incidents = $script:IncidentCount
            recoveries = $script:RecoveryCount
            recoveriesAfterPrinterRestartMarker = $script:RecoveryAfterRestartMarkerCount
            spontaneousRecoveries = $spontaneousRecoveries
            incidentStillActiveAtEnd = $script:IncidentActive
            restartAssessment = $restartAssessment
            fatalError = $script:FatalError
        }
        recoveryLogPath = $script:PartialLogPath
        events = $events
    }

    $json = $report | ConvertTo-Json -Depth 16
    [System.IO.File]::WriteAllText($script:ReportPath, $json, $script:Utf8NoBom)
}

$initialState = [ordered]@{}
$environmentSnapshot = [ordered]@{}
$exitCode = 0

try {
    Write-ConsoleStatus "DineFlow HS-M80 SPP Diagnostics v$($script:ToolVersion)" ([ConsoleColor]::Cyan)
    Write-ConsoleStatus "Mode=$Mode, port=$PortName. Automatic printing is disabled by default."
    Write-ConsoleStatus 'Keys: Q stop; R mark printer restart; S status probe; T manual TEST (only when enabled).'
    Write-ConsoleStatus "Recovery log: $($script:PartialLogPath)" ([ConsoleColor]::DarkGray)

    $environmentSnapshot = [ordered]@{
        computerName = $env:COMPUTERNAME
        userName = $env:USERNAME
        osVersion = [Environment]::OSVersion.VersionString
        is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        bluetoothAdapters = @(Get-BluetoothAdapterSnapshot)
    }

    $qzProcesses = @(Get-QzProcessSnapshot)
    $printerQueue = Get-PrinterQueueSnapshot
    $initialPorts = @(Get-AvailablePortNames)
    $initialBthEvents = @(Get-RecentBthUsbEvents -MaxEvents 20)

    $initialState = [ordered]@{
        availablePorts = $initialPorts
        targetPortPresent = $initialPorts -contains $PortName
        qzProcesses = $qzProcesses
        printerQueue = $printerQueue
        recentBthUsbEvents = $initialBthEvents
    }

    Write-DiagnosticEvent 'run_started' @{
        runId = $runId
        portName = $PortName
        mode = $Mode
        dryRun = [bool]$DryRun
    }

    if (-not $DryRun) {
        if ($qzProcesses.Count -gt 0 -and -not $AllowQzRunning) {
            Stop-Preflight "QZ Tray is still running ($($qzProcesses.processName -join ', ')). Fully exit QZ Tray, then run this tool again."
        }

        if (-not $printerQueue.querySucceeded -and -not $AllowPrinterQueueCheckFailure) {
            Stop-Preflight "Could not verify Windows printer queue '$PrinterQueueName': $($printerQueue.queryError). Run this tool as Administrator, then try again."
        }

        if ($printerQueue.exists -and $printerQueue.jobCount -gt 0 -and -not $AllowQueuedPrintJobs) {
            Stop-Preflight "Printer queue '$PrinterQueueName' still has $($printerQueue.jobCount) queued job(s). Cancel or safely pause/clear those jobs before testing, then run again."
        }

        if ($printerQueue.exists -and $printerQueue.printerStatus -notmatch '(?i)paused' -and -not $AllowUnpausedPrinterQueue) {
            Stop-Preflight "Printer queue '$PrinterQueueName' is not paused (status: $($printerQueue.printerStatus)). Pause it before testing so Windows cannot take $PortName."
        }

        if ($printerQueue.exists) {
            Write-ConsoleStatus "Windows queue '$PrinterQueueName': status=$($printerQueue.printerStatus), jobs=$($printerQueue.jobCount). Do not print to it during this test." ([ConsoleColor]::Yellow)
        }
    }

    Initialize-BthUsbCursor

    do {
        Read-InteractiveCommands
        $portPresent = Invoke-PortPoll
        Invoke-ScheduledWork $portPresent
        Import-NewBthUsbEvents

        if (Test-DurationReached) {
            Write-DiagnosticEvent 'configured_duration_reached' @{}
            Write-ConsoleStatus 'Configured duration reached. Saving the report...' ([ConsoleColor]::Yellow)
            $script:StopRequested = $true
        }

        if (-not $script:StopRequested) {
            Start-Sleep -Seconds $PollIntervalSeconds
        }
    } while (-not $script:StopRequested)
}
catch {
    $exitCode = 1
    $details = Get-ExceptionDetails $_.Exception
    $script:FatalError = $details
    Write-DiagnosticEvent 'fatal_error' $details
    Write-ConsoleStatus "Test stopped: $($details.message)" ([ConsoleColor]::Red)
}
finally {
    Close-DiagnosticSerialPort 'run-ending'
    Import-NewBthUsbEvents

    try {
        Save-FinalReport -InitialState $initialState -EnvironmentSnapshot $environmentSnapshot
        Write-ConsoleStatus "Final report: $($script:ReportPath)" ([ConsoleColor]::Green)
        Write-ConsoleStatus "Recovery log: $($script:PartialLogPath)" ([ConsoleColor]::DarkGray)
    }
    catch {
        $exitCode = 1
        Write-ConsoleStatus "Failed to save final JSON: $($_.Exception.Message)" ([ConsoleColor]::Red)
        Write-ConsoleStatus "The recovery log is still available at: $($script:PartialLogPath)" ([ConsoleColor]::Yellow)
    }
}

exit $exitCode
