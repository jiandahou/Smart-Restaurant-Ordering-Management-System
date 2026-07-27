using System.Net;
using System.Text.Json.Serialization;
using Microsoft.Win32;

const string listenUrl = "http://127.0.0.1:17891";

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.UseUrls(listenUrl);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

var app = builder.Build();

app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";

    var origin = context.Request.Headers.Origin.ToString();
    if (OriginPolicy.IsAllowed(origin))
    {
        context.Response.Headers.AccessControlAllowOrigin = origin;
        context.Response.Headers.Append("Vary", "Origin");
        context.Response.Headers.AccessControlAllowMethods = "GET, OPTIONS";
        context.Response.Headers.AccessControlAllowHeaders = "Content-Type";

        if (string.Equals(
                context.Request.Headers["Access-Control-Request-Private-Network"],
                "true",
                StringComparison.OrdinalIgnoreCase))
        {
            context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
        }
    }

    if (HttpMethods.IsOptions(context.Request.Method))
    {
        context.Response.StatusCode = StatusCodes.Status204NoContent;
        return;
    }

    await next();
});

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "DineFlow.PrinterBridge",
    version = typeof(Program).Assembly.GetName().Version?.ToString(),
}));

app.MapGet("/printers", () =>
{
    if (!OperatingSystem.IsWindows())
    {
        return Results.Problem("Windows printer discovery is only available on Windows.");
    }

    try
    {
        return Results.Ok(new
        {
            printers = WindowsPrinterDiscovery.ReadPrinters(),
            detectedAt = DateTimeOffset.UtcNow,
        });
    }
    catch (Exception exception)
    {
        return Results.Problem(
            detail: exception.Message,
            title: "Unable to read Windows printer queues",
            statusCode: StatusCodes.Status500InternalServerError);
    }
});

Console.WriteLine($"DineFlow Printer Bridge listening on {listenUrl}");
Console.WriteLine("This service only reads Windows printer queue and port metadata. Press Ctrl+C to stop.");
await app.RunAsync();

internal static class OriginPolicy
{
    private static readonly HashSet<string> ConfiguredOrigins = BuildConfiguredOrigins();

    public static bool IsAllowed(string origin)
    {
        if (string.IsNullOrWhiteSpace(origin))
        {
            return false;
        }

        if (ConfiguredOrigins.Contains(origin.TrimEnd('/')))
        {
            return true;
        }

        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        {
            return false;
        }

        return uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
               || IPAddress.TryParse(uri.Host, out var address) && IPAddress.IsLoopback(address);
    }

    private static HashSet<string> BuildConfiguredOrigins()
    {
        var origins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "https://dineflow.theunknownfish.com",
        };

        var configured = Environment.GetEnvironmentVariable("DINEFLOW_PRINTER_BRIDGE_ALLOWED_ORIGINS");
        if (string.IsNullOrWhiteSpace(configured))
        {
            return origins;
        }

        foreach (var origin in configured.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            origins.Add(origin.TrimEnd('/'));
        }

        return origins;
    }
}

internal static class WindowsPrinterDiscovery
{
    private const string PrintersRegistryPath = @"SYSTEM\CurrentControlSet\Control\Print\Printers";
    private const string TcpPortsRegistryPath =
        @"SYSTEM\CurrentControlSet\Control\Print\Monitors\Standard TCP/IP Port\Ports";
    private const string SerialMapRegistryPath = @"HARDWARE\DEVICEMAP\SERIALCOMM";

    public static IReadOnlyList<WindowsPrinterQueue> ReadPrinters()
    {
        var defaultPrinter = ReadDefaultPrinterName();
        var bluetoothPorts = ReadBluetoothSerialPorts();
        var printers = new List<WindowsPrinterQueue>();

        using var printersKey = Registry.LocalMachine.OpenSubKey(PrintersRegistryPath);
        if (printersKey is null)
        {
            return printers;
        }

        foreach (var keyName in printersKey.GetSubKeyNames())
        {
            using var printerKey = printersKey.OpenSubKey(keyName);
            if (printerKey is null)
            {
                continue;
            }

            var name = ReadString(printerKey, "Name") ?? keyName;
            var driverName = ReadString(printerKey, "Printer Driver");
            var portName = ReadString(printerKey, "Port")?.Trim() ?? string.Empty;
            var connection = ClassifyConnection(name, driverName, portName, bluetoothPorts);

            printers.Add(new WindowsPrinterQueue(
                Name: name,
                DriverName: driverName,
                PortName: NullIfEmpty(portName),
                ConnectionKind: connection.Kind,
                ConnectionLabel: connection.Label,
                HostAddress: connection.HostAddress,
                PortNumber: connection.PortNumber,
                IsVirtual: connection.IsVirtual,
                IsDefault: string.Equals(name, defaultPrinter, StringComparison.OrdinalIgnoreCase),
                SharedPortQueueCount: 1));
        }

        var portCounts = printers
            .Where(printer => !string.IsNullOrWhiteSpace(printer.PortName))
            .GroupBy(printer => printer.PortName!, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.OrdinalIgnoreCase);

        return printers
            .Select(printer => printer with
            {
                SharedPortQueueCount = printer.PortName is not null
                    ? portCounts.GetValueOrDefault(printer.PortName, 1)
                    : 1,
            })
            .OrderByDescending(printer => printer.IsDefault)
            .ThenBy(printer => printer.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static PrinterConnection ClassifyConnection(
        string name,
        string? driverName,
        string portName,
        IReadOnlySet<string> bluetoothPorts)
    {
        var normalizedPort = portName.Trim().TrimEnd(':');
        var virtualPrinter = IsVirtualPrinter(name, driverName, portName);
        if (virtualPrinter)
        {
            return new PrinterConnection("virtual", "Virtual printer", IsVirtual: true);
        }

        if (normalizedPort.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(normalizedPort.AsSpan(3), out _))
        {
            if (bluetoothPorts.Contains(normalizedPort))
            {
                return new PrinterConnection("bluetooth", $"Bluetooth SPP · {normalizedPort}");
            }

            return new PrinterConnection("serial", $"Serial · {normalizedPort}");
        }

        if (normalizedPort.StartsWith("USB", StringComparison.OrdinalIgnoreCase)
            && normalizedPort.AsSpan(3).IndexOfAnyExceptInRange('0', '9') < 0)
        {
            return new PrinterConnection("usb", $"USB · {normalizedPort}");
        }

        if (portName.StartsWith("WSD-", StringComparison.OrdinalIgnoreCase))
        {
            return new PrinterConnection("network-wsd", "Network · WSD");
        }

        if (portName.StartsWith(@"\\", StringComparison.OrdinalIgnoreCase))
        {
            return new PrinterConnection("shared", $"Shared printer · {portName}");
        }

        var tcpPort = ReadTcpPort(portName);
        if (tcpPort is not null)
        {
            var endpoint = tcpPort.PortNumber is > 0
                ? $"{tcpPort.HostAddress}:{tcpPort.PortNumber}"
                : tcpPort.HostAddress;
            return new PrinterConnection(
                "network",
                $"Network · {endpoint}",
                HostAddress: tcpPort.HostAddress,
                PortNumber: tcpPort.PortNumber);
        }

        if (IPAddress.TryParse(normalizedPort, out _))
        {
            return new PrinterConnection("network", $"Network · {normalizedPort}", HostAddress: normalizedPort);
        }

        return new PrinterConnection("unknown", "Connection unknown");
    }

    private static TcpPort? ReadTcpPort(string portName)
    {
        if (string.IsNullOrWhiteSpace(portName))
        {
            return null;
        }

        using var portKey = Registry.LocalMachine.OpenSubKey($@"{TcpPortsRegistryPath}\{portName}");
        if (portKey is null)
        {
            return null;
        }

        var host = ReadString(portKey, "HostName")
                   ?? ReadString(portKey, "IPAddress")
                   ?? (IPAddress.TryParse(portName, out _) ? portName : null);
        if (string.IsNullOrWhiteSpace(host))
        {
            return null;
        }

        var rawPort = portKey.GetValue("PortNumber");
        var portNumber = rawPort switch
        {
            int value => value,
            long value when value is > 0 and <= ushort.MaxValue => (int)value,
            string value when int.TryParse(value, out var parsed) => parsed,
            _ => (int?)null,
        };

        return new TcpPort(host, portNumber);
    }

    private static HashSet<string> ReadBluetoothSerialPorts()
    {
        var ports = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var serialMapKey = Registry.LocalMachine.OpenSubKey(SerialMapRegistryPath);
        if (serialMapKey is null)
        {
            return ports;
        }

        foreach (var valueName in serialMapKey.GetValueNames())
        {
            if (!valueName.Contains("BTH", StringComparison.OrdinalIgnoreCase)
                && !valueName.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (serialMapKey.GetValue(valueName) is string port && !string.IsNullOrWhiteSpace(port))
            {
                ports.Add(port.Trim().TrimEnd(':'));
            }
        }

        return ports;
    }

    private static string? ReadDefaultPrinterName()
    {
        using var windowsKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows NT\CurrentVersion\Windows");
        var device = ReadString(windowsKey, "Device");
        return device?.Split(',', 2, StringSplitOptions.TrimEntries)[0];
    }

    private static bool IsVirtualPrinter(string name, string? driverName, string portName)
    {
        var identity = $"{name} {driverName}".ToUpperInvariant();
        if (identity.Contains("MICROSOFT PRINT TO PDF")
            || identity.Contains("MICROSOFT XPS")
            || identity.Contains("ONENOTE")
            || identity.Contains("FAX")
            || identity.Contains("PDFCREATOR")
            || identity.Contains("CUTEPDF")
            || identity.Contains("ADOBE PDF"))
        {
            return true;
        }

        return portName.Equals("FILE:", StringComparison.OrdinalIgnoreCase)
               || portName.Equals("PORTPROMPT:", StringComparison.OrdinalIgnoreCase)
               || portName.Equals("NUL:", StringComparison.OrdinalIgnoreCase)
               || portName.Equals("SHRFAX:", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ReadString(RegistryKey? key, string name)
        => key?.GetValue(name) as string is { } value && !string.IsNullOrWhiteSpace(value)
            ? value.Trim()
            : null;

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private sealed record PrinterConnection(
        string Kind,
        string Label,
        string? HostAddress = null,
        int? PortNumber = null,
        bool IsVirtual = false);

    private sealed record TcpPort(string HostAddress, int? PortNumber);
}

internal sealed record WindowsPrinterQueue(
    string Name,
    string? DriverName,
    string? PortName,
    string ConnectionKind,
    string ConnectionLabel,
    string? HostAddress,
    int? PortNumber,
    bool IsVirtual,
    bool IsDefault,
    int SharedPortQueueCount);
