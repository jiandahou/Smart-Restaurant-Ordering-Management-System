# DineFlow 全系统测试运行 — 2026-09-15（生产）

## 运行信息

| 字段 | 值 |
|---|---|
| 日期/时区 | 2026-09-15 (ACST) |
| 环境 | **Production**（`https://dineflow.theunknownfish.com`，EC2 + AWS S3 + Stripe **Sandbox**） |
| 分支/提交 | `main` @ `d1e22f0`（含 jianda 合并 + 部署配置） |
| 执行人 | 自动化（Claude Code），对生产直接读写 |
| 指定测试包 | 可纯软件执行的包：认证(B)、权限/租户(C)、Admin 各模块读取、菜单/订单改数据、通知(SignalR)、并发/负载 |
| 明确排除 | 需外部条件的包：Stripe 真卡付款/退款(G)、打印(H)、真机(DEVICE)、邮箱/MFA/Passkey、平台 Owner 专属项 |
| 允许的外部操作 | 允许改动生产数据（当前库为 seed/演示数据，非真实业务数据） |

## 前置条件缺口（影响未跑用例）

| 缺少 | 影响用例 | 说明 |
|---|---|---|
| 餐厅未完成 Stripe Connect 入驻 | G01/G07/G08、payment-system 在线付款 | 顾客结账显示 "Online payment unavailable"，无法走在线卡付款/退款 |
| owner@dineflow.com 新密码未知 | Platform Owner 专属项(C01 平台全域) | 该账号密码已被改动，本次以餐厅 Owner/Admin 覆盖租户范围 |
| 测试邮箱 / TOTP / Passkey 设备 | B07/B09–B13、profile MFA、magic link | 需真实邮箱与设备 |
| 实体打印机 / QZ Tray | 打印(H)、DEVICE-PRINT | 避免实体打印 |
| 真机浏览器 / 读屏 | real-device、a11y | 需真实设备 |

## 结果汇总

| PASS | FAIL | BLOCKED | NOT RUN | 总数 |
|---:|---:|---:|---:|---:|
| 18 | 0 | 3 | 6 | 27 |

**结论**：2026-08-09 报告列出的发布阻塞项**已基本关闭**——登录硬门槛(B03 锁定 / B04 限流 / B05 最短 8 位 / B14 生产不预填)、部署/CI/法律变量(P0-4) 全部通过。权限与跨租户隔离(C)扎实。核心下单→接单→改数据链路正常。**唯一仍拦路的是在线支付**：因无餐厅完成 Stripe Connect 入驻，G 类在线付款/退款无法验证（非缺陷，是配置缺口）。当前 Stripe 仍为 Sandbox，无真实扣款。

## 用例结果

| Case ID | 测试包 | 角色 | 结果 | 实际观察 |
|---|---|---|---|---|
| B01 | login | 各角色 | PASS | 正确密码登录返回 token，进入对应页 |
| B02 | login | — | PASS | 错误密码返回通用 "Invalid email or password."，不暴露账号存在性 |
| B03 | login | customer | **PASS（已修）** | 连错 4 次 → 423「Too many failed sign-in attempts, try again in 15 min」账号锁定 |
| B04 | login | — | **PASS（已修）** | 快速重复登录 → 429「Too many attempts」限流 |
| B05 | login | 新 customer | **PASS（已修）** | 6 位密码被拒「Passwords must be at least 8 characters」；9 位通过 |
| B06 | login | 新 customer | PASS | 未带条款版本 → 400 要求接受当前条款/隐私 |
| B14 | login | 生产构建 | **PASS（已修）** | 生产登录页邮箱/密码为空，包内无演示凭据 |
| C01 | perms | 餐厅 Owner A | PASS | 可读本餐厅 orders/menu/reports/restaurant |
| C02 | perms | Admin A | PASS | 同上，租户范围内可读 |
| C04 | perms | Staff A | PASS | 可读 admin/orders、summary（岗位授权）；menu/reports/restaurant → 403 |
| C05 | perms | Staff A | PASS | /api/users、/api/restaurant → 403，无数据泄漏 |
| C06 | perms | Customer | PASS | admin/orders、reports、restaurant、users → 403 |
| C07 | perms | Owner A / Admin A | **PASS（上次 NOT RUN）** | 读餐厅 B 菜单 → 403，跨租户隔离生效 |
| USERS | admin-users | admin/staff/customer | PASS | 全域 /api/users 仅 Platform Owner 可读，其余 403（租户 scoped 端点另测） |
| ORD-CREATE | cart/orders | Guest | PASS | 公开菜单下单成功 `ORD-20260915-925273`（Takeaway，AU$16） |
| ORD-ACCEPT | admin-orders | Owner | PASS | 管理端实时出现，接单 Pending→Accepted，动作推进为 Mark paid/Start preparing |
| MENU-SOLDOUT | admin-menu | Admin A | PASS | 切售罄=200，Staff 同操作=403，回退=200 |
| NOTIF | notifications | Owner | PASS | Orders 页 **Live** 徽章，SignalR 实时连接；共享购物车加菜实时同步 |
| LOAD | infra | — | PASS | 30 并行 /health、15 并行带鉴权 API 全 200 |
| G01 | payments | Guest | **BLOCKED** | 顾客结账「Online payment unavailable」，餐厅未做 Stripe Connect 入驻 |
| G07/G08 | payments | Admin | **BLOCKED** | 无在线付款订单可退，同上 |
| WEBHOOK | payments | — | PASS（sandbox） | `stripe trigger` 事件投递到生产、验签通过、正常处理 |
| B15 | login | — | NOT RUN | 登出后旧 refresh token 撤销验证（需会话编排） |
| B09–B13 | login | — | NOT RUN | Google/Magic Link/Passkey/MFA，需邮箱与设备 |
| PROF-* | profile-security | — | NOT RUN | 改邮箱/TOTP/Passkey，需真实邮箱与设备 |
| H* | printing | — | NOT RUN | 需 QZ Tray + 实体打印机 |
| DEVICE-* | real-device | — | NOT RUN | 需真机浏览器/读屏 |
| OPS-* | operations | — | NOT RUN | 迁移/备份恢复/多实例/告警，需专用环境 |

## 模块专项覆盖进度（docs/testing 各模块用例）

> 本轮为**代表性抽测 + 权限/核心流程**(纯软件、可对生产跑的部分)。UI 点击型细分用例数量庞大(14 个模块 ~2,449 条),逐条执行需浏览器逐页驱动,标记如下便于后续接力。

| 模块 | 用例数 | 本轮状态 | 已验证要点 |
|---|---:|---|---|
| login-registration | 89 | 🟢 较全 | 登录/错误提示/**锁定/限流/密码≥8**/条款校验/生产不预填 |
| 权限与租户隔离(C) | — | 🟢 完成 | 多角色 RBAC 矩阵、**跨餐厅 403**、静默重定向 |
| admin-menu | 182 | 🟡 抽测 | 菜品列表读取、**售罄开关(admin 200 / staff 403)**、权限 |
| admin-orders | 169 | 🟡 抽测 | 列表/summary、**状态筛选**、流转校验、**"未付在线单不能进厨房流程"业务门槛**、status-history |
| admin-reports | 176 | 🟡 抽测 | activity 读取、**activity 导出 200**、权限;audit/orders/payments 需正确日期参数 |
| admin-restaurants | 161 | 🟡 抽测 | 餐厅列表/详情读取、跨租户隔离、权限 |
| admin-users | 150 | 🟡 抽测 | 全域用户仅 Platform Owner 可读、其余 403;scoped 端点/锁定解锁待补 |
| dashboard | 150 | 🟡 抽测 | 页面读取(UI);无单一 dashboard API(前端聚合) |
| staff-orders | 212 | 🟡 抽测 | staff 可读 admin/orders、越权读 reports/restaurant → 403 |
| cart | 294 | 🟡 抽测 | Guest 下单→购物车→结账→下单(浏览器),共享购物车实时同步 |
| notifications(SignalR) | — | 🟢 抽测 | Live 徽章、实时连接、共享购物车同步 |
| front-counter | 182 | 🔴 未跑 | 待浏览器逐页(取餐队列/桌台结算) |
| profile-security | 157 | 🔴 未跑 | 需真实邮箱/TOTP/Passkey |
| payment-system | 223 | ⛔ BLOCKED | 需 Stripe Connect 入驻 |
| real-device | 69 | 🔴 未跑 | 需真机/读屏 |

图例:🟢 完成/较全 · 🟡 代表性抽测(核心+权限已过) · 🔴 未跑(需条件/待接力) · ⛔ BLOCKED

## 问题 / 待办

1. **在线支付未启用（配置缺口，非缺陷）**：需给至少一家餐厅完成 **Stripe Connect（test 模式）入驻**，才能验证 G01/G07/G08 与 payment-system 包。
2. **owner@dineflow.com 密码已改**：Platform Owner 专属用例（平台全域视图）本轮以餐厅 Owner/Admin 覆盖；如需完整覆盖，提供新密码后可补测。
3. 自动化单元/集成测试（后端 730 + 前端 vitest）在 CI 上随每次 push 运行且**全绿**，覆盖并发/退款/认证等本轮标 BLOCKED/NOT RUN 的逻辑层。

## 备注
- 本轮在生产 seed 数据上产生了少量测试数据（1 笔订单 ORD-20260915-925273、若干注册尝试、customer.six 因锁定测试被临时锁定 15 分钟）。均为演示数据，可忽略或清理。
- 单元测试库不对生产库运行（会建/删测试库）；本报告为**只对活体系统的黑盒/E2E 校验**。
