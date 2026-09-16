# DineFlow 生产测试总报告 — 2026-09-16

> **一份自包含报告，供跨 session 接力。** 汇总 2026-09-16 对**生产环境**的测试结果。
> 上一轮是 [production-test-report-2026-09-15.md](production-test-report-2026-09-15.md)，本轮在它的基础上推进。
> 单元/集成测试（后端 730+ 前端 vitest）随 CI 每次 push 运行，不在此重复；本报告只覆盖**对活体系统的黑盒/E2E 校验**。

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST) |
| 环境 | **Production** `https://dineflow.theunknownfish.com`（EC2 + S3 + Cloudflare Tunnel） |
| 分支/提交 | `main` @ `6ed7440`（含 AUDIT-01..07 与选项组校验修复） |
| 后端环境变量 | `ASPNETCORE_ENVIRONMENT=Staging` |
| Stripe | **Sandbox（测试模式）**，无真实扣款；卡号取自 Stripe 官方测试卡 |
| 数据 | seed/演示数据；本轮产生的测试数据**未清理**，见第 5 节 |

## 1. 结论（TL;DR）

- **09-15 的两个阻塞项都已解除**：选项组空名校验在 `3f66128` 修掉了；餐厅 A 完成 Stripe Connect 入驻，`payment-system` 从 ⛔ 变成可跑。
- 本轮跑完两个模块的可自动化面：**payment-system** 与 **front-counter**，合计 **101 项断言，100 PASS / 1 FAIL**。
- **在线支付主链路端到端打通**：下单 → Checkout → 支付 → 回跳 → webhook 对账 → 厨房接单 → 退款。
- **1 个确认的代码缺陷**（现金收款无上限）、**2 个上线前必须处理的配置/数据问题**。见第 4 节。

## 2. 本轮结果

### 2.1 payment-system（详见 [payment-system-test-run-2026-09-16.md](payment-system-test-run-2026-09-16.md)）

41 项断言全绿 + 1 张成功卡 + 1 张 decline 卡。

| 分组 | 结果 | 要点 |
|---|:-:|---|
| 权限与租户隔离 | 15/15 | 拿**别单的 guest token** → 401；Admin B 跨店 → 403 |
| 支付资格 | 5/6 | 已付/已取消/PayAtCounter 全 409，不重复收费 |
| Session 与开放重定向 | 3/3 | 8 组重定向探针全被归一化；同单二次调用复用同一 Session |
| Webhook 验签 | 5/5 | 三种伪造**措辞完全一致**，探测不出哪个 secret 管哪个 destination |
| 退款生命周期 | 11/11 | 部分 → 全额 → 重复退；超额/零/负全拒 |
| 成功卡 | PASS | A$48.00 逐分相等；`stripeFee 198 / net 4602 / platformFee 0`；direct charge 落在餐厅账户 |
| Decline 卡 | PASS | 订单没被误当成已付，且付款路径可恢复 |

未跑：3DS/Radar/争议、Klarna 异步路径、其余成功卡矩阵、结果页轮询/移动端/无障碍。

### 2.2 front-counter（详见 [front-counter-test-run-2026-09-16.md](front-counter-test-run-2026-09-16.md)）

60 项断言，59 PASS / 1 FAIL。

| 分组 | 结果 | 要点 |
|---|:-:|---|
| 角色与租户隔离 | 13/13 | Customer token 当 Staff 用 → 403；Staff A 强传 `restaurantId=B` → **403 而非静默降级** |
| 收款、完成与 tender | 9/10 | 非法 tender 不会静默当 Card；**唯一 FAIL 是现金无上限** |
| Void 与 Offline Refund | 15/15 | 已有退款的收款不能再 Void；柜台冲正打不到 Stripe 支付上 |
| 桌台与整桌结算 | 10/10 | 任一单未 Ready → 整桌 409 且**原子不变**；同桌重新落座开新 session |
| 队列与线上线下边界 | 13/13 | **Stripe session 活着时禁止切柜台收款** → 挡住重复收款 |

未跑：页面加载与实时恢复、搜索/分组细节、订单卡片内容、收据与打印路由、无障碍、并发双会话。

## 3. 各模块覆盖进度矩阵

| 模块 | 用例数 | 状态 | 说明 |
|---|---:|---|---|
| login-registration | 89 | 🟢 较全 | 09-15：锁定/限流/密码/条款/生产不预填 |
| 权限与租户隔离(C) | — | 🟢 完成 | 09-15：多角色 RBAC + 跨租户 403 |
| **payment-system** | 223 | 🟡 **主链路+安全面已跑** | **09-16 新**；剩 3DS/争议/Klarna/成功卡矩阵 |
| **front-counter** | 182 | 🟡 **API 面已深跑** | **09-16 新**；剩浏览器/打印/无障碍/并发 |
| admin-menu | 182 | 🟡 Auto 已深跑 | 09-15：24 PASS/1 FAIL(已修)/1 未确认；剩 PAGE/IMG/REC/PUB |
| admin-orders | 169 | 🟡 抽测 | 筛选/流转校验/支付门槛/status-history |
| **admin-reports** | 176 | 🟡 **权限/隐私/导出面已深跑** | **09-16 新**，见 [admin-reports-test-run-2026-09-16.md](admin-reports-test-run-2026-09-16.md)；32 PASS / 2 FAIL / 1 NOT RUN |
| admin-restaurants | 161 | 🟡 抽测 | 列表/详情/跨租户隔离 |
| admin-users | 150 | 🟡 抽测 | 全域仅 Platform Owner 可读 |
| admin-payments | 166 | 🟡 抽测 | 在线付款/退款已随 payment-system 覆盖一部分 |
| dashboard | 150 | 🟡 抽测 | 页面读取（前端聚合，无单一 API） |
| staff-orders | 212 | 🟡 抽测 | staff 可读订单、越权 → 403 |
| cart | 294 | 🟡 抽测 | 下单→购物车→结账→下单、共享同步 |
| notifications(SignalR) | — | 🟢 抽测 | Live 徽章、实时同步 |
| **profile-security** | 157 | 🟡 **只读面 + TOTP 全生命周期已跑** | **09-16 新**，见 [profile-security-test-run-2026-09-16.md](profile-security-test-run-2026-09-16.md)；40 项 39 PASS；Passkey/Email MFA 需设备与收件箱 |
| **real-device** | 69 | 🔴 **未跑** | 需真机/读屏 |

图例：🟢 完成/较全 · 🟡 代表性抽测或单面深跑 · 🔴 未跑

## 4. 问题清单

| # | 严重度 | 问题 | 位置 / 修法 |
|---|---|---|---|
| 1 | **确认缺陷** | **现金收款金额没有上限**：应收 A$24.00 的单，输入现金 `5000.00` 被接受且提示应找 **A$4976.00**；整桌结算同样路径。前后端都只校验「不少于应收」 | 后端 `StaffFrontCounterController.ValidateTender`（约 L1115），前端 `FrontCounterPage.tsx` 的 `cashEntryValid`（约 L974）与 `<Input min>` 无 `max`。**两处都要改**。账目未受污染（Payment 仍记账单金额），属操作风险 |
| 2 | **上线前必须改** | **connected account 的 business name 与餐厅名不一致**：Stripe 上是「Central Market Table」，餐厅是「The DineFlow Kitchen」。Checkout 页与卡账单都显示前者 | 系统自身的 `merchant_identity_mismatch` 校验报得没错，是入驻时填错。改 Stripe 连接账户上的业务名 |
| 3 | **上线前必须补** | **餐厅主数据缺失**：`legalBusinessName` 为空、`abn` 与 `refundContactEmail` 为空/null。**会直接打在小票和收据上** | seed 数据缺口，非代码缺陷。Admin → Restaurants 补齐 |
| 4 | **中（对账/合规）** | **payments 报表导出不含金额与币种**：`PaymentEventLog` 实体本身没有金额字段，唯一可能装金额的 `DataJson` 只对 PlatformOwner 导出。保留期 2555 天（7 年）的支付证据，餐厅 Owner/Admin 导出来**看不到多少钱** | 给 `PaymentEventLog` 加 `AmountCents`+`Currency` 并在写入时填充 |
| 5 | 低（API 契约） | **不传 `sortBy` 时 audit/orders/payments 返回 400，activity 却正常**：`PagedRequest.SortBy` 默认 null 而排序无默认值。前端写死了 `createdAt` 所以 UI 碰不到，但直接调 API 会踩。**这也更正了 09-15 报告「需正确日期参数」的误判——与日期无关** | `ApplyAuditSorting` 给 `createdAt` 默认值 |
| 6 | **中（影响注册漏斗）** | **注册确认信进 Gmail 垃圾箱**（「与过去被判定为垃圾邮件的消息相似」，发信域 `noreply@theunknownfish.com`）。不点确认信就无法登录，等于新顾客注册在最后一步断掉，而接口返回的是 `confirmationEmailSent: true`，用户侧看不出原因 | **非代码缺陷**——邮件确实发出且被 Resend 接受。查 `theunknownfish.com` 的 SPF/DKIM/DMARC 是否为 Resend 正确配置、该域是否已在 Resend 完成验证 |
| 7 | 提示 | Klarna 在连接账户上是启用的，但异步支付路径（`checkout.session.async_payment_*`）零覆盖 | 要么正式环境关掉，要么补测 |
| 8 | 待确认（承接 09-15） | MENU-ALG-04 的 `allergenInfoLastVerifiedAt` | 浏览器复核 |
| 9 | 说明（承接 09-15） | `owner@dineflow.com` 密码已被改动 | Platform Owner 专属用例需新密码后补测 |

## 5. 本轮产生的测试数据（**未清理**）

生产库（餐厅 A）今日新增约 **40+ 笔测试订单**，含：

- 1 笔真实沙盒收款 A$48.00 并已全额退款（`ORD-20260916-551113`）
- 1 笔 decline 失败单
- **2 个测试账号**：`qa.sec.20260916@dineflow.test`（未确认、惰性、24h 自动清理）与
  `burnmydread4+dineflowqa20260916@gmail.com`（已确认、MFA 已关闭、状态干净）
- 若干柜台现金/刷卡收款、Void 与线下退款记录
- 桌台 T3 / T4 上有开放 session

> 其中相当一部分是 `Pending`，**会出现在真实厨房队列里**。上一轮的惯例是跑完即清，
> 但删除生产订单不可逆，本轮保留并列出，由执行者决定是否清理。

## 6. 接力指引

环境、seed 账号、餐厅 ID、跑法与注意事项，与
[production-test-report-2026-09-15.md 第 6 节](production-test-report-2026-09-15.md#6-接力指引其他-session-接着跑)完全一致，此处不重复。
两点补充：

- **下单要带当期条款版本**：`acceptedCustomerTermsVersion` / `acknowledgedPrivacyPolicyVersion` /
  `acknowledgedAllergenNoticeVersion` 当前都是 `2026-08-08`，传旧值会 400。
- **购物车流程顺序**：join → 加商品（必选选项组必须带 `selectedOptionIds`）→ **checkout** →
  **再**选 payment-method。顺序反了会 409「Cart must be checked out before selecting payment.」

**优先接力项**

1. **修问题 #1 现金上限**（前后端各一处 + 回归测试）
2. **查 `theunknownfish.com` 的邮件投递配置**（问题 #6）——注册漏斗断在这里
3. **PROF-MFA-29/30/31**（P0）：Magic Link / Google OAuth / Passkey 三条登录路径是否绕过 MFA
4. payment-system 剩余：3DS / 争议 / Klarna 异步
5. front-counter 剩余：浏览器逐页、收据与打印路由
6. admin-orders / cart / staff-orders 从抽测升级为深跑
