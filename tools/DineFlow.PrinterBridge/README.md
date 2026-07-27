# DineFlow Printer Bridge

A small, read-only Windows helper for the DineFlow printer settings page.

QZ Tray can list Windows printer queue names, but it does not expose the
Windows `PortName` needed to distinguish USB, Bluetooth SPP, TCP/IP, WSD,
shared, and virtual queues. This helper reads that metadata from the Windows
registry and serves it only on:

`http://127.0.0.1:17891/printers`

It never submits, pauses, resumes, or deletes print jobs.

## Run for development

```powershell
dotnet run --project .\tools\DineFlow.PrinterBridge\DineFlow.PrinterBridge.csproj
```

The default permitted browser origins are localhost and
`https://dineflow.theunknownfish.com`. Add other trusted deployments with a
semicolon-separated environment variable:

```powershell
$env:DINEFLOW_PRINTER_BRIDGE_ALLOWED_ORIGINS = 'https://staging.example.com;https://app.example.com'
```
