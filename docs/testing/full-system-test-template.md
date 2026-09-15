# DineFlow 测试运行模板

复制本文件建立新的运行记录，或明确调用 `$dineflow-system-test` 让 Skill 自动生成 `test-results/<timestamp>/`。除非明确要求 `full`，只运行用户指定的测试包或用例。

## 运行信息

| 字段 | 值 |
|---|---|
| 日期/时区 |  |
| 环境 | Local / Test / Staging / Production-read-only |
| 分支/提交 |  |
| 测试前 dirty 数量 |  |
| 执行人 |  |
| 指定测试包/Case IDs |  |
| 明确排除 |  |
| 允许的外部操作 |  |

## 前置条件

在执行前填写。缺少账号或设备时先通知用户；未提供的场景不得假装通过。

| 条件 | Ready | 缺少内容 | 影响用例 | 可以先执行的部分 |
|---|---|---|---|---|
| Platform Owner |  |  |  |  |
| 两个餐厅的 Owner/Admin/Staff |  |  |  |  |
| 已确认/未确认 Customer |  |  |  |  |
| Profile Primary/Social-only/Secondary Customer |  |  | PROF-* |  |
| Profile 新邮箱、TOTP app、Passkey 设备 |  |  | PROF-EMAIL-* / PROF-MFA-* / PROF-PK-* |  |
| Dashboard PlatformOwner、Owner/Admin/Staff A/B |  |  | DASH-ROLE-* / DASH-SUM-* |  |
| Dashboard 测试订单、桌台、Watched item、营业日历 |  |  | DASH-ORD-* / DASH-URL-* / DASH-OPS-* / DASH-WATCH-* |  |
| Admin Menu PlatformOwner、Owner/Admin/Staff A/B |  |  | MENU-ROLE-* / MENU-PAGE-* |  |
| Admin Menu 一次性分类/菜品/选项、食品信息、测试图片 |  |  | MENU-CAT-* / MENU-ITEM-* / MENU-ALG-* / MENU-OPT-* / MENU-IMG-* |  |
| Admin Payments PlatformOwner、Owner/Admin/Staff A/B |  |  | PAY-ROLE-* / PAY-PAGE-* |  |
| Admin Payments 两家 Stripe Sandbox connected account、一次性订单与多币种支付/退款矩阵 |  |  | PAY-CHECK-* / PAY-SETTLE-* / PAY-REF-* / PAY-REQ-* |  |
| Admin Payments webhook/故障控制、专用测试邮箱、实体移动/读屏设备 |  |  | PAY-WEB-* / PAY-SETTLE-09 / PAY-REC-* |  |
| Cart Guest A/B、Customer A/B、同店/跨店 Staff |  |  | CART-SES-* / CART-XPG-* |  |
| Cart 桌码、菜单/库存/选项矩阵、可控时钟/DB |  |  | CART-ENTRY-* / CART-OPT-* / CART-VAL-* |  |
| Cart 双标签、移动设备、测试打印队列 |  |  | CART-RT-* / CART-RSP-* / CART-CHK-* |  |
| 通知角色/跨店账号、SignalR 断连、测试事件和测试邮箱 |  |  | NOTIF-* |  |
| 全链路 Guest/Customer/Staff/Admin 会话、唯一订单/桌台/支付/退款 fixture |  |  | E2E-* |  |
| Disposable migration/restore DB、两个 API 实例、告警渠道和压力环境 |  |  | OPS-* |  |
| iPhone Safari、Android Chrome、平板、桌面浏览器和辅助技术 |  |  | DEVICE-MOB-* / DEVICE-TAB-* / DEVICE-A11Y-* / DEVICE-DESK-* |  |
| QZ Tray、实体打印机、纸张和睡眠/重启授权 |  |  | DEVICE-PRINT-* / DEVICE-REC-* |  |
| Login/Registration 专用身份 `burnmydread8@gmail.com` |  |  | LR-* |  |
| Google/Facebook 测试账号 |  |  |  |  |
| 测试邮箱访问 |  |  |  |  |
| TOTP/Passkey 设备与用户手势 |  |  |  |  |
| Stripe Sandbox/webhook 控制 |  |  |  |  |
| 可退款测试付款 |  |  |  |  |
| QZ Tray/打印机/纸张 |  |  |  |  |
| Staging/备份/告警权限 |  |  |  |  |

`login-registration`、`profile-security`、`dashboard`、`admin-menu`、`admin-payments`、`admin-reports`、`cart`、`notifications`、`end-to-end-operations`、`operations-release` 和 `real-device` 默认都不执行。只有明确选择对应测试包、`LR-*`、`PROF-*`、`DASH-*`、`MENU-*`、`PAY-*`、`RPT-*`、`CART-*`、`NOTIF-*`、`E2E-*`、`OPS-*`、`DEVICE-*` 或 `full` 时才检查专用身份与设备；规划阶段可查看 tab 标题确认邮箱服务，但不得打开邮箱或邮件。

## 结果汇总

| PASS | FAIL | BLOCKED | NOT RUN | 总数 |
|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 |

结论：

## 用例结果

| Case ID | 测试包 | 账号/角色 | 结果 | 实际观察 | 截图/日志 | 复测 |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## 问题表

| Issue ID | 优先级 | 摘要 | Case ID | 证据 | 建议 | 负责人 | 状态 |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |

## 需要用户完成的测试

Agent 只能在你报告结果后把这些用例改成 PASS/FAIL。

| Case ID | Agent 已完成 | 你需要操作 | 应观察到 | 你的结果 |
|---|---|---|---|---|
|  |  |  |  |  |

常见接力：

- 打开指定测试邮箱中的确认/Magic Link，并把“成功/失败和页面文案”告诉 Agent，不提供邮箱密码或 OTP。
- 在浏览器提示时完成 Touch ID、Windows Hello 或 TOTP 操作。
- Agent 发起一张明确授权的测试票后，检查内容、切纸、声音、漏打或重打。
- 在手机/平板上按指定步骤完成关键流程并提供截图。

## 发布结论（仅 release/full 范围填写）

- P0 未关闭：
- P1 已接受/未关闭：
- Stripe 验收：
- 打印验收：
- 备份恢复：
- 告警演练：
- 是否允许真实订单：
- 需要复测的 Case IDs：
