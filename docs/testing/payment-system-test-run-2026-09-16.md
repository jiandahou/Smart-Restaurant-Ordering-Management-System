# payment-system 生产测试run — 2026-09-16

> 2026-09-15 总报告里 `payment-system(223)` 标为 ⛔ BLOCKED（无餐厅完成 Stripe Connect 入驻）。
> 2026-09-16 餐厅 A 完成 test 模式入驻后，本轮把该模块解锁并跑完在线支付主链路。
> 接力入口仍是 [production-test-report-2026-09-15.md](production-test-report-2026-09-15.md)。

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST) |
| 环境 | Production `https://dineflow.theunknownfish.com` |
| 分支/提交 | `main` @ `6ed7440`（含 AUDIT-01..07 + option-group 修复） |
| Stripe | **Sandbox（测试模式）**，Checkout 页带 `Sandbox` 徽标；卡号全部取自 Stripe 官方测试卡 |
| 餐厅 A connected account | `acct_...r71J`（direct charge，`Ready` / charges + payouts enabled） |
| 餐厅 B | `NotConnected`，且当前在营业时间外，未能作为对照组 |

## 1. 结论

- **在线支付端到端打通**：下单 → Checkout Session → Stripe Hosted Checkout → 支付 → 回跳 → webhook 对账 → 厨房接单 → 退款，全链路正确。
- **41 条自动化断言全绿**，覆盖权限/租户隔离、支付资格、Session 复用、开放重定向、webhook 验签、退款边界。
- **2 个需在正式上线前处理的问题**（均为配置/数据，非代码缺陷），见第 6 节。
- 仍有 3 类未覆盖：3DS/Radar/争议、异步支付方式（Klarna）、真机与无障碍。

## 2. 主链路（PS-CARD-01 / PS-SESSION-03,05 / PS-STATE）

订单 `ORD-20260916-551113`，2 × Butter Chicken = **A$48.00**，Visa `4242`：

| 核对点 | 结果 |
|---|---|
| Stripe Checkout 行项目 | `Butter Chicken / Qty 2 / A$24.00 each / A$48.00` — 与订单**逐分相等** |
| 币种 | AUD |
| 收款账户 | 餐厅 A 的 connected account（direct charge，未走平台账户） |
| 回跳 | `/payment/success` → 「Payment confirmed」 |
| Payment 记录 | `Paid`，`amountCents 4800`，`paidAt` 已写 |
| 费用拆分 | `stripeFee 198` / `net 4602` / `platformFee 0`（与当前 0% 平台费配置一致） |
| 对账凭据 | `payment_intent` / `charge` / `receiptUrl` / `receiptEmail` 均已落库 |
| webhook | `lastProviderEventCreatedAt` 与 `lastSyncedAt` 在支付后 ~12s 内写入 |
| 厨房联动 | 付款后 `Accept` → `Accepted` 200（未付时该转换是 409，回归一致） |

## 3. 自动化断言明细

### 3.1 权限与租户隔离（15/15 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-ROLE-01 | PASS | Customer 支付自己的订单 → 200 |
| PS-ROLE-02 | PASS | Customer A 支付 B 的订单 → 403 |
| PS-ROLE-03 | PASS | Guest 持正确 token → 200 |
| PS-ROLE-04a/b/c | PASS | 无 token → 401；错 token → 401；**拿别单的 token → 401** |
| PS-ROLE-05a/b/c | PASS | Staff A / Admin A 本店订单 → 200；**Admin B 跨店 → 403** |
| PS-ROLE-06 | PASS | Admin B 同步 A 的 payment → 403 |
| PS-ROLE-06b | PASS | Admin A 同步未支付 session → 409「Stripe has not created a payment intent for this checkout session yet.」（诚实拒绝，非缺陷） |
| PS-ROLE-08 | PASS | 未登录调他人订单 → 401，不暴露订单是否存在 |
| PS-ROLE-09a/b/c | PASS | 随机 UUID → 404；畸形 id → 400；空 GUID → 400。无堆栈/SQL |

### 3.2 支付资格与订单边界（6/6 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-ELIG-01 | PASS | Online Pending 订单可开 Checkout |
| PS-ELIG-02 | PASS | PayAtCounter 调线上 Checkout → 409「configured for payment at the counter」 |
| PS-ELIG-03 | PASS | 已 Paid 订单再开 Checkout → 409，**不重复收费** |
| PS-ELIG-04 | PASS | 取消后支付 → 409「Cancelled or rejected orders cannot be paid.」 |
| PS-ELIG-06 | PASS | 空购物车在**建单前**就被拒（400「Cart is empty.」），不存在 $0 Session |
| PS-ELIG-09 | 部分 | 餐厅 B `NotConnected`，但当时在营业时间外，连购物车都建不了 → 「Stripe 未配置时线上入口不可用」这一条**未能验证**，需在 B 的营业时段补跑 |

### 3.3 Session 创建与开放重定向（3/3 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-SESSION-07 | PASS | 合法 `returnTo` → 200 |
| PS-SESSION-08 | PASS | 8 组探针（`https://evil…`、`//evil…`、`javascript:`、`%2F%2F`、`/admin/restaurants`、`/menu/../../admin/users` 等）**全部归一化或拒绝，无开放重定向，响应中不回显外部域** |
| PS-SESSION-复用 | PASS | 同一订单二次调用 → 复用同一 `sessionId` + `paymentId`，不产生第二个 Payment |

### 3.4 Webhook 验签（5/5 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-WH-01/02 | PASS | 无签名 / 垃圾签名 → 400 |
| PS-WH-03 | PASS | 带 `account` 的 connected 事件 + 错签名 → 400 |
| PS-WH-04 | PASS | **三种情况措辞完全一致**（`Invalid Stripe webhook signature.`）——探测不出哪个 secret 管哪个 destination |
| PS-WH-05 | PASS | 畸形 body → 400，无堆栈/异常类型 |

### 3.5 Decline（1 张，PASS）

Visa `4000 0000 0000 0002`，订单 `ORD-20260916-773131`：

- Stripe 页面显示简短可行动文案，停在原页；
- Payment → `Failed`，`failureReason` 为通用的「Your card was declined.」，**未泄露风控细节**；
- `paidAt` 为空、无 `chargeId`、订单仍 `Pending` —— **没有被误当成已付**；
- 同一订单重新发起支付 → 200，且**新开一个 Session**（不复用失败的那个），付款路径可恢复。

### 3.6 退款全生命周期（11/11 PASS）

对已付的 A$48.00：

| 用例 | 结果 | 观察 |
|---|---|---|
| 跨租户 | PASS | Admin B 退 A 的款 → 403 |
| 部分退款 | PASS | 退 $12 → `PartiallyRefunded`，refunded=1200 / refundable=3600 |
| 超额退款 | PASS | 退 $9999.99 → 409「refund amount is no longer available」 |
| 零/负金额 | PASS | 均 400「must be greater than zero」 |
| 退余额 | PASS | 再退 $36 → `Refunded`，refunded=4800 / refundable=0 / count=2 |
| 重复退款 | PASS | 已全退再退 → 409 |
| 订单联动 | PASS | 全额退款后订单转为 `Cancelled` |

## 4. 覆盖矩阵更新

| 模块 | 用例数 | 09-15 | 09-16 |
|---|---:|---|---|
| **payment-system** | 223 | ⛔ BLOCKED | 🟡 **主链路 + 安全面已跑**（41 断言 + 1 成功卡 + 1 decline） |

## 5. 未覆盖（下一棒）

- **3DS / Radar / 争议**（第 10、16 节，20 条）：需 `4000002500003155`、`4000000000000259` 等触发卡。
- **异步支付方式**：连接账户上 **Klarna 是启用状态**，但 `checkout.session.async_payment_succeeded/failed` 这条路径一条没测。要么在正式环境关掉，要么补测。
- **其余成功卡矩阵**（PS-CARD-02..08）：debit、Mastercard 2-series、Amex 4 位 CVC、eftpos 双品牌。
- **结果页轮询 / popup 阻止 / 移动端 / 无障碍**（第 11、19 节）。
- **PS-ELIG-09** 待餐厅 B 营业时段补跑。

## 6. 发现的问题

| # | 严重度 | 问题 | 证据 / 修法 |
|---|---|---|---|
| 1 | **上线前必须改** | **connected account 的 business name 与餐厅名不一致**：Stripe 上写的是「Central Market Table」，餐厅实际是「The DineFlow Kitchen」。Checkout 页标题、"Back to …"、"Pay securely at …" 全部显示前者，卡账单也会。顾客认不出商户名正是发起 dispute 的典型诱因 | `payment-settings` 已自行报出 `merchant_identity_mismatch`（severity Error，`business_profile.name`）——校验本身是对的，是**入驻时填错了**。改 Stripe 连接账户上的业务名即可 |
| 2 | 上线前须补 | **餐厅缺法定名称、ABN 与地址**：`legalBusinessName` 为空、`abn`/地址为 null，订单响应里也是 null。AU 税务发票需要供应商身份与 ABN | 属 seed 数据缺口，非代码缺陷。正式环境 `Compliance__*` 有硬门槛，但**餐厅级**的这几项要在 Admin → Restaurants 里补齐 |
| 3 | 提示 | Klarna 在连接账户上是启用的，而异步支付路径无任何测试覆盖 | 见第 5 节 |

## 7. 本轮产生的测试数据（**未清理**）

生产库今天新增 **23 笔测试订单**（餐厅 A，合计 A$576.00）：21 笔 `Pending`、2 笔 `Cancelled`；
其中 1 笔真实收款并已全额退款（`ORD-20260916-551113`），1 笔 `Failed`（decline 用例）。

> 21 笔 Pending 会**出现在真实厨房队列里**。上一轮报告的惯例是跑完即清，但删除生产订单不可逆，
> 本轮保留并在此列出，由执行者决定是否清理。
