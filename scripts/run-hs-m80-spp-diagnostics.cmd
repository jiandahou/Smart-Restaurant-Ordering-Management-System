@echo off
setlocal
title DineFlow HS-M80 SPP Diagnostics

echo.
echo DineFlow HS-M80 SPP Diagnostics
echo ==================================
echo Run this launcher as Administrator so the safety check can inspect
echo the POS80 Printer(2) queue.
echo.
echo 1. Keep COM4 open, no automatic traffic (recommended first test)
echo 2. Open and close COM4 every 30 seconds
echo 3. Keep COM4 open and send a non-printing status query every 30 seconds
echo.
echo The tool will NOT print unless you run the PowerShell script manually
echo with -EnablePrintTest.
echo.
set /p DINEFLOW_SPP_MODE=Choose 1, 2 or 3 [1]: 

if "%DINEFLOW_SPP_MODE%"=="" set DINEFLOW_SPP_MODE=1

if "%DINEFLOW_SPP_MODE%"=="2" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0hs-m80-spp-diagnostics.ps1" -PortName COM4 -Mode Cycle -CycleIntervalSeconds 30 -DurationMinutes 120
    goto finished
)

if "%DINEFLOW_SPP_MODE%"=="3" (
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0hs-m80-spp-diagnostics.ps1" -PortName COM4 -Mode KeepOpen -EnableStatusProbe -StatusProbeIntervalSeconds 30 -DurationMinutes 120
    goto finished
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0hs-m80-spp-diagnostics.ps1" -PortName COM4 -Mode KeepOpen -DurationMinutes 120

:finished
echo.
echo Diagnostics finished. Check Downloads\DineFlow-SPP-Diagnostics for the JSON report.
pause
endlocal
