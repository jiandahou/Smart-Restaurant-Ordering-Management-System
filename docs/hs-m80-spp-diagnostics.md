# HS-M80 蓝牙 SPP 稳定性测试

这个工具直接通过 Windows 串口访问 HS-M80，不经过 DineFlow 网页、QZ Tray 或 Windows 打印驱动。

文件：

- `scripts/hs-m80-spp-diagnostics.ps1`：诊断程序
- `scripts/run-hs-m80-spp-diagnostics.cmd`：交互式启动器

## 测试前

1. 完全退出 QZ Tray，而不只是关闭浏览器页面。
2. 打开 `POS80 Printer(2)` 队列，取消不需要的旧测试页，然后暂停该队列。
3. 测试期间不要恢复该队列，也不要使用 Windows 队列打印。
4. 确认蓝牙 SPP 端口仍是 COM4；如果号码变了，用 PowerShell 参数指定新端口。
5. 右键启动器，选择“以管理员身份运行”。本机普通权限无法读取打印队列，诊断程序会安全停止。

诊断程序发现 QZ Tray 仍运行、无法核实队列状态、队列仍有任务或队列没有暂停时，默认都会拒绝开始。这是为了避免 COM4 被抢占，或旧测试页突然打印。

## 最简单的启动方式

右键并选择“以管理员身份运行”：

```text
scripts\run-hs-m80-spp-diagnostics.cmd
```

启动器提供三种测试：

1. **保持连接、无自动流量**：推荐首先运行，用来观察纯空闲连接是否失效。
2. **每 30 秒开关连接**：检查 RFCOMM 会话能否被反复正确释放。
3. **保持连接并每 30 秒查询状态**：查询不会出纸，可检查主动通信是否稳定。

默认运行 120 分钟。

## 运行中的按键

| 按键 | 作用 |
|---|---|
| `Q` | 停止测试并保存最终 JSON |
| `R` | 标记“刚刚重启/断电重启了打印机” |
| `S` | 立即发送一次不出纸的 ESC/POS 状态查询 |
| `T` | 立即发送一张小 TEST，仅在启动时显式启用打印测试后有效 |

如果连接失败后准备重启打印机，请先按 `R` 做标记，然后马上关机再开机。这样可避免测试器在重启完成后自动抢先重连，导致错过重启标记。报告会记录连接是否只在这个标记之后恢复。

## 命令行示例

保持 COM4 打开两小时，不主动发送数据：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\hs-m80-spp-diagnostics.ps1 `
  -PortName COM4 `
  -Mode KeepOpen `
  -DurationMinutes 120
```

每 30 秒打开和关闭 COM4：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\hs-m80-spp-diagnostics.ps1 `
  -PortName COM4 `
  -Mode Cycle `
  -CycleIntervalSeconds 30 `
  -DurationMinutes 120
```

保持连接并每 30 秒发送一次不出纸的实时状态查询：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\hs-m80-spp-diagnostics.ps1 `
  -PortName COM4 `
  -Mode KeepOpen `
  -EnableStatusProbe `
  -StatusProbeIntervalSeconds 30 `
  -DurationMinutes 120
```

每五分钟打印一张很小的 ASCII TEST：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\hs-m80-spp-diagnostics.ps1 `
  -PortName COM4 `
  -Mode KeepOpen `
  -EnablePrintTest `
  -PrintIntervalMinutes 5 `
  -DurationMinutes 60
```

打印测试不会自动切纸，只打印一行并走纸三行。没有 `-EnablePrintTest` 时，按 `T` 也不会打印。

持续运行直到按 `Q`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\hs-m80-spp-diagnostics.ps1 `
  -PortName COM4 `
  -Mode KeepOpen `
  -DurationMinutes 0
```

## 输出

默认输出到：

```text
Downloads\DineFlow-SPP-Diagnostics
```

每次运行产生两个文件：

- `*.ndjson`：实时追加的恢复日志。即使终端或 PowerShell 意外退出，已经记录的内容仍然存在。
- `*.json`：正常结束时生成的完整报告，包括配置、蓝牙适配器与驱动、初始/最终端口、BTHUSB 事件、错误分类、恢复统计和完整时间线。

如果安全预检拒绝启动，程序仍会输出 JSON，里面保留当时的 QZ、打印队列、COM 端口和蓝牙驱动快照。

主要错误分类：

- `PortBusyOrAccessDenied`
- `PortNotFound`
- `IncorrectSerialPort`
- `Timeout`
- `DeviceDisconnected`
- `SerialIOException`

## 建议测试顺序

1. 运行模式 1，保持空闲至少一小时。接近过去会掉线的时长后按 `S`。
2. 如果失败，不关闭工具，重启打印机并立即按 `R`，观察是否恢复。
3. 再运行模式 2 至少一小时，检查反复开关是否导致会话卡死。
4. 最后根据需要运行模式 3 或小票测试。

如果模式 1/2 在完全退出 QZ 后仍复现，而且只有打印机重启标记后才恢复，证据更偏向 HS-M80 的 Bluetooth Classic SPP/RFCOMM 模块或固件。若独立工具长期稳定而 QZ 不稳定，则转向 QZ 的串口生命周期处理。
