# DineFlow 生产测试总报告 — 2026-09-16

> **一份自包含报告，供跨 session 接力。** 汇总 2026-09-16 的生产测试，并合并本地分支随机测试。第 2.3 节及问题 #12–15 仅在本地复现，不能视为生产已验证。
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
- payment-system/front-counter 阶段发现现金上限缺陷和 2 个配置/数据问题；后续 reports/profile-security 发现见第 4 节。
- **本地随机测试新增 51 PASS / 4 FAIL（4 个独立缺陷，#12–15）**：Guest 重试凭证无效、删除购物车引用菜品 500、选项组负数下界、库存整数溢出。生产与本地统计分开，不累计为一次生产验收。

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

### 2.3 本地分支随机测试（合并补充）

环境：本地 Docker，`localhost:5173` / `localhost:5000`；分支 `jianda-payment-test-2026-09-16` @ `b383b05cb564c2e7b59005974990e703b4f0232b`，初始工作区干净。后端起初还是 09-12 镜像，已用当前分支重建；以下只计重建后的结果。**51 PASS / 4 FAIL**，固定随机种子 `9162026`。

通过：25 次随机加菜逐次核对行数量、总数与金额（最终 71 份 / 230.75）；8 次相同幂等键并发只加 1 份；5 轮减数量/删除竞争均收敛为空、无 500；8 请求竞争库存 3 恰好 3 成功；两个独立购物车争最后一份 checkout 得到 200/409；用有效原始凭证并发取消得到 200/409/409、库存只归还一次。数量边界、备注 4000/4001 字边界、Guest Unicode/RTL 文本存取、购物车凭证隔离和法律确认拒绝均通过；空白选项组名修复回归通过。

未执行：本轮浏览器/打印、Stripe 退款、addon 库存专项、同桌多身份所有权和时间专项。**取消归还库存不等于退款归还库存通过**。HTML-like 备注存取通过不等于 UI/打印渲染安全通过。

详情：[本地随机测试报告](local-random-test-report-2026-09-16.md)。本地可重跑脚本与 JSON 证据位于 `test-results/20260916-130254/`（该目录被 gitignore 忽略，不随共享仓库传递；本总报告已包含全部缺陷复现步骤）。未修改业务代码。

### 2.4 本地邮箱测试

用户已登录两个测试 Gmail；当前实际执行账号为 `burnmydread8@gmail.com`。使用本地邮件配置回跳 `http://10.118.160.10:5173`；已确认地址可用且浏览器权限获批。未操作生产账号。

| 用例 | 状态 | 实际观察 |
|---|---|---|
| Magic Link 请求 UI | PASS | Email link 输入测试邮箱，显示通用发送提示；发送时按钮禁用 |
| Magic Link 邮件送达 | PASS | 09-16 16:35 邮件收到，后端记录发信成功；但在 Spam，见下一行 |
| 邮件进入正常收件箱 | FAIL（关联 #6，非新缺陷） | 本地 Magic Link 和 16:36 密码重置信都进 Gmail Spam；Gmail 提示类似过去被识别为垃圾邮件的消息。不能仅据此断定 SPF/DKIM/DMARC 失败 |
| Magic Link 首次登录 | PASS | 打开本轮新邮件链接后进入 `/me`，显示正确邮箱与 Customer 角色。此行在 MFA 未启用时执行，本身不构成防绕过证据——防绕过见下方 EMAIL-04 |
| Magic Link 同一链接重放 | PASS | 再点击同一邮件按钮，显示 `Magic link sign-in failed`，没有再次成功登录 |
| 密码重置请求与送达 | PASS | User Center → Reset my password；收到新重置信，链接指向本地 `/reset-password` |
| 密码重置表单 | PASS | 显示 Set new password、确认框、8 字符及大小写/数字/符号要求 |
| 密码重置提交 | PASS | 用户完成提交；本地审计 `Auth.PasswordResetCompleted`，2026-09-16 07:09:38 UTC。未读取新密码 |
| 重置链接重放、新密码登录恢复 | 本地 NOT RUN，**已由生产轮覆盖** | 本地未跑：当时 `/me` 仍有旧会话，不能据此判断新密码登录成功。生产轮已验证：重放同一重置链接 → 400「invalid or expired」，新密码可登录、旧密码 401（PROF-PWD-09d/e/f，见 [profile-security 报告](profile-security-test-run-2026-09-16.md)） |
| 邮箱 MFA 设置请求 UI | PASS | User Center → MFA → Email code，显示 Email MFA code sent 与六位验证码设置弹窗 |
| 邮箱 MFA 启用 | PASS | 用户完成设置；界面确认 Email code ON、Login ON，Sensitive actions OFF |
| Magic Link 不绕过 MFA（EMAIL-04） | PASS | 退出 LAN 本地会话后使用 16:44 新邮件，进入 Verify it is you 六位验证码挑战，没有直接进入账户 |
| MFA 完成前受保护页面 | PASS | 同浏览器另开 `/me`，加载后跳转 `/login`，未显示账户资料 |
| MFA 错误验证码 | PASS | 提交一次错误六位码，显示 That code is not right，仍停留挑战页 |
| MFA 正确验证码及登录恢复 | PASS | 用户输入正确验证码并提交；浏览器核验进入 `/me`，邮箱为指定测试账号、角色 Customer，显示 Protected Login |
| MFA 登录后刷新会话 | PASS | 刷新 `/me` 后仍显示相同测试账号、Customer 与 Protected Login，未丢失会话 |

统计：14 PASS / 1 FAIL（已有投递问题）/ 0 BLOCKED / 1 本地未跑但已由生产轮覆盖。没有保存邮件 token、验证码或新密码到报告。

**与生产轮的关系**：本节在**本地**环境走 UI 逐页验证，生产轮（[profile-security 报告](profile-security-test-run-2026-09-16.md)）走 API 验证同一批语义。两边在 Magic Link 不绕过 MFA、链接单次消费、邮箱验证码单次消费上**独立得到一致结论**，互为交叉验证而非重复计数——**两处统计不相加**。生产轮另外覆盖了本地没做的：旧验证码批量失效（连发 7 个只有最新有效）、验证码与 challenge 绑定不可串用、四种方式都关不掉 MFA、关闭后 secret 确实清除。

**仍未完成**：第二邮箱交叉验证、邮箱变更流程。Passkey 需真实硬件手势，两边都做不了。

> **遗留待处理**：本地测试账号的 **Email MFA 与 Login protection 仍处于启用状态**，未关闭。
> 生产轮的测试账号（`burnmydread4+dineflowqa20260916@gmail.com`）已确认关闭并恢复干净。
> 本地这个账号若还要复用，需要先用邮件验证码关掉，或直接废弃。

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
| 7 | **中（可轰炸邮箱）** | **两个已鉴权的发信端点完全没有限流**：`POST /api/auth/mfa/email/setup` 与 `POST /api/auth/mfa/sensitive/email-code` 连发 6 次全部 200，无 429、无 `Retry-After`。**实测连发 7 次 → 7 封全部送达**。对比：匿名的 `request-password-reset` / `request-magic-link` **是有限流的** | 把匿名端点已有的限流套到这两个上，按 userId + 收件地址计数并返回 `Retry-After`。影响：盗号者可用邮件洪水淹掉安全告警、无限消耗 Resend 额度、拉低发信域信誉（正是问题 #6 的成因） |
| 8 | **待隔离**（非结论） | **失败尝试之后合法的密码重置链接失效**：先做几次篡改 token 的尝试，之后真链接也 400；而全新链接直接走正常路径则成功。若成立则是**账号找回的可用性攻击**（userId 就在链接里）。但应用层无自定义作废逻辑，也可能只是从 Gmail 会话里抓到了旧邮件的链接 | 复现步骤见 [profile-security 报告 #3](profile-security-test-run-2026-09-16.md)。**未确认，不要当缺陷处理** |
| 9 | 提示 | Klarna 在连接账户上是启用的，但异步支付路径（`checkout.session.async_payment_*`）零覆盖 | 要么正式环境关掉，要么补测 |
| 10 | 待确认（承接 09-15） | MENU-ALG-04 的 `allergenInfoLastVerifiedAt` | 浏览器复核 |
| 11 | 说明（承接 09-15） | `owner@dineflow.com` 密码已被改动 | Platform Owner 专属用例需新密码后补测 |
| 12 | **P1 · 本地确认** | **Guest checkout 重试返回不可用新凭证**；同 orderId，但新凭证读不到订单、取消 403，旧凭证仍有效 | `PublicCartsController` 重试分支修改 `AsNoTracking` 实体，哈希未持久化；详见下方复现 |
| 13 | **P1 · 本地确认** | **删除购物车引用的菜品返回 500** | `AdminMenuItemsController.DeleteItem` 未处理 `CartItems` 外键引用；需明确归档/下架或受控 409 策略 |
| 14 | **P2 · 本地确认** | **可选选项组允许 `minSelections=-2`** | `MenuOptionGroupController.CreateGroup` 缺少非负下界；Update 同时检查 |
| 15 | **P2 · 本地确认** | **库存 int.MaxValue 再加 1 返回 500** | `AdminMenuItemsController.UpdateStock` 数据库整数加法溢出，需上限校验 |

### 本地新增缺陷的复现与验收

**#12 / LOCAL-0916-01（独立复现三轮）**：Guest join → 加菜 → checkout，保存首次 `guestAccessToken` → 相同 cart 再 checkout。两次均 200 且 orderId 相同；分别调用 `POST /api/order/guest`，原凭证返回 1 单，新凭证返回 0 单；新凭证取消返回 403。重试响应确实含非空 token。源码重试分支约 884–915 行修改 hash 后 SaveChanges，但 `LoadOrderAsync` 约 1671 行 `AsNoTracking()`，修改未保存。首次响应丢失或客户端覆盖旧 token 后会失去订单访问。验收：重试新凭证能查询/取消；同时明确并测试多设备凭证更新行为。

**#13 / LOCAL-0916-02**：创建临时菜品 → 加入购物车 → Admin `DELETE /api/admin/menu/items/{id}`，500 / PostgreSQL `23503` / `FK_CartItems_MenuItems_MenuItemId`。源码 DeleteItem 约 1009–1037 行直接 Remove/SaveChanges。验收：活跃/历史购物车引用都不会触发 500，顾客侧显示正确不可用提示或服务端给出可操作冲突信息。Development 堆栈不据此推定生产泄漏。

**#14 / LOCAL-0916-03**：`POST /api/menu/items/{itemId}/option-groups`，传 `{name:"Negative bounds",minSelections:-2,maxSelections:1}`，返回 201 并保存 -2。验收：创建/更新均拒绝负数，0 和合法必选规则通过。

**#15 / LOCAL-0916-04**：`PATCH /api/admin/menu/items/{id}/stock` 传 `{stockQuantity:2147483647}` 返回 200；随后传 `{adjustBy:1}` 返回 500。验收：越界受控拒绝，库存不被部分修改；并发加减仍原子。

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

本地数据收尾：新增的 3 个未支付订单均 Cancelled，库存各恢复为 1，专用订单菜品已下架；保留订单/审计证据。随机测试菜品已删除，早期限流遗留的购物车条目按精确 ID 清理；空购物车等待正常过期。这与第 5 节尚未清理的**生产**数据不同。

邮箱接力：用户已完成两个 Gmail 账号登录；下一轮只测本地应用邮件链路。尚未记录本地邮件测试 PASS，不能沿用生产邮件结论。

环境、seed 账号、餐厅 ID、跑法与注意事项，与
[production-test-report-2026-09-15.md 第 6 节](production-test-report-2026-09-15.md#6-接力指引其他-session-接着跑)完全一致，此处不重复。
两点补充：

- **下单要带当期条款版本**：`acceptedCustomerTermsVersion` / `acknowledgedPrivacyPolicyVersion` /
  `acknowledgedAllergenNoticeVersion` 当前都是 `2026-08-08`，传旧值会 400。
- **购物车流程顺序**：join → 加商品（必选选项组必须带 `selectedOptionIds`）→ **checkout** →
  **再**选 payment-method。顺序反了会 409「Cart must be checked out before selecting payment.」

**优先接力项**

1. **修问题 #1 现金上限**（前后端各一处 + 回归测试）
   同时优先处理本地 P1 **#12 Guest 重试凭证**、**#13 菜品删除 500**；#14–15 为输入边界修复。
2. **查 `theunknownfish.com` 的邮件投递配置**（问题 #6）——注册漏斗断在这里
3. **PROF-MFA-29/30/31**（P0）：Magic Link / Google OAuth / Passkey 三条登录路径是否绕过 MFA
4. payment-system 剩余：3DS / 争议 / Klarna 异步
5. front-counter 剩余：浏览器逐页、收据与打印路由
6. admin-orders / cart / staff-orders 从抽测升级为深跑
