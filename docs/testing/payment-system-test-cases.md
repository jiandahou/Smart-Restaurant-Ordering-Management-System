# DineFlow Payment System 专项测试用例

测试包名称：`payment-system`（兼容选择名：`stripe-payment`）  
稳定用例前缀：`PS-*`  
用例总数：160  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `payment-system`、`stripe-payment`、某个 `PS-*`，或明确要求 `full` 时才执行。

本包覆盖从订单取得支付资格、创建 Stripe Checkout Session、Hosted Checkout、成功/失败卡、3DS、支付结果页、Webhook、后台对账、金额/币种/平台费、幂等并发、退款、Radar/争议，到订单、厨房、通知、收据与审计的完整线上支付链路。

相邻测试包不要重复完整执行：

- Admin Payments 三标签、筛选、直接退款、退款审批、CSV → [admin-payments-test-cases.md](admin-payments-test-cases.md)
- Cart/共享桌台/库存/Checkout 前订单创建 → [cart-test-cases.md](cart-test-cases.md)
- Stripe Connect 开通、商户资料与费率设置 → [admin-restaurants-test-cases.md](admin-restaurants-test-cases.md)
- 厨房支付阻断 → [staff-orders-test-cases.md](staff-orders-test-cases.md)
- 柜台现金/刷卡、找零、Void/offline refund → [front-counter-test-cases.md](front-counter-test-cases.md)
- Admin 订单退款明细 → [admin-orders-test-cases.md](admin-orders-test-cases.md)

## 1. 资金安全、执行规则与官方测试数据

- 任何 Checkout、退款、Webhook 重放、争议、收据邮件只能在 Stripe **Sandbox/Test mode** 和本轮一次性订单执行。
- Production 默认只读；看到 `Live`、无法确认 key mode、connected account 归属不明时，所有资金写操作立即停止。
- DineFlow 使用 Stripe Connect **direct charges**：Charge/PaymentIntent 应位于餐厅 connected account，平台只收配置的 application fee。
- 不把真实卡、真实身份、税号或银行资料用于测试；不在文档、代码、日志或截图保存真实 PAN/CVC。
- 交互式 Stripe Hosted Checkout 可以输入下列官方测试卡。自动化/API 测试优先使用 `pm_card_*`，不要由后端代码直接提交卡号。
- 普通交互测试统一使用未来有效期（如 `12/34`）和任意合法 CVC；Amex 用 4 位，其他通常 3 位。需要验证 CVC/日期错误的场景按矩阵单独输入。
- 测试前后逐笔核对 Order、Payment、Refund、Webhook Event、Audit、connected account 与 application fee；Sandbox 退款不可回滚，必须登记。
- 报告不得包含 secret、完整 access/guest token、完整 Stripe Session/Intent/Charge/Refund ID、顾客完整邮箱/电话或卡号截图。
- 官方测试数据来源：[Stripe Testing](https://docs.stripe.com/testing)；本矩阵最后核对日期：2026-08-17。

### 1.1 交互式成功卡矩阵

| 场景 | 卡号 | 自动化 PaymentMethod | 预期 |
|---|---|---|---|
| Visa credit | `4242 4242 4242 4242` | `pm_card_visa` | 成功 |
| Visa debit | `4000 0566 5566 5556` | `pm_card_visa_debit` | 成功 |
| Mastercard | `5555 5555 5555 4444` | `pm_card_mastercard` | 成功 |
| Mastercard 2-series | `2223 0031 2200 3222` | — | 成功 |
| Mastercard debit | `5200 8282 8282 8210` | `pm_card_mastercard_debit` | 成功 |
| Amex | `3782 822463 10005` | `pm_card_amex` | 成功；4 位 CVC |
| Discover | `6011 1111 1111 1117` | `pm_card_discover` | 成功 |
| Diners Club | `3056 9309 0902 0004` | `pm_card_diners` | 成功 |
| JCB | `3566 0020 2036 0505` | `pm_card_jcb` | 成功 |
| UnionPay | `6200 0000 0000 0005` | `pm_card_unionpay` | 成功；以当前 Sandbox/Checkout 支持为准 |
| AU eftpos/Visa co-brand | `4000 0503 6000 0001` | `pm_card_visa_debit_eftposAuCoBranded` | 成功 |
| AU eftpos/Mastercard co-brand | `5555 0503 6000 0080` | `pm_card_mastercard_debit_eftposAuCoBranded` | 成功 |

### 1.2 支付失败与输入错误矩阵

| 场景 | 卡号/输入 | Stripe code/decline code | DineFlow 预期 |
|---|---|---|---|
| Generic decline | `4000 0000 0000 0002` | `card_declined / generic_decline` | 不得 Paid；可安全重试 |
| Insufficient funds | `4000 0000 0000 9995` | `card_declined / insufficient_funds` | 简短提示；不泄露内部响应 |
| Lost card | `4000 0000 0000 9987` | `card_declined / lost_card` | 不得履约；顾客文案保持适度 |
| Stolen card | `4000 0000 0000 9979` | `card_declined / stolen_card` | 不得履约；内部可审计 |
| Expired card | `4000 0000 0000 0069` | `expired_card` | 提示换卡；可重试 |
| Incorrect CVC | `4000 0000 0000 0127` | `incorrect_cvc` | 必须实际输入任意 3 位 CVC 才触发检查 |
| Processing error | `4000 0000 0000 0119` | `processing_error` | 可恢复；不创建第二订单/重复付款 |
| Incorrect number | `4242 4242 4242 4241` | `incorrect_number` | Hosted Checkout 本地拒绝，不发有效支付 |
| Velocity exceeded | `4000 0000 0000 6975` | `card_declined / card_velocity_exceeded` | 限速提示；不误标欺诈终态 |
| Attach succeeds, charge declines | `4000 0000 0000 0341` | charge decline | 若未来支持 saved card，保存成功不代表扣款成功 |
| Invalid expiry month | 月份 `13` | `invalid_expiry_month` | 表单就地拒绝 |
| Invalid expiry year | 过去年份，如 `95` | `invalid_expiry_year` | 表单就地拒绝 |
| Invalid CVC length | `99` | `invalid_cvc` | 表单就地拒绝 |

### 1.3 3DS、Radar、争议与异步退款矩阵

| 场景 | 卡号 | 自动化 PaymentMethod | 预期 |
|---|---|---|---|
| 3DS required success | `4000 0000 0000 3220` | `pm_card_threeDSecure2Required` | 完成 challenge 后成功 |
| 3DS required then decline | `4000 0084 0000 1629` | `pm_card_threeDSecureRequiredChargeDeclined` | 认证后仍拒付 |
| 3DS lookup error | `4000 0084 0000 1280` | `pm_card_threeDSecureRequiredProcessingError` | 安全失败，可换卡 |
| 3DS optional success | `4000 0000 0000 3055` | `pm_card_threeDSecureOptional` | 成功 |
| 3DS optional processing error | `4000 0000 0000 3097` | `pm_card_threeDSecureOptionalProcessingError` | 若触发 3DS 则错误可恢复 |
| 3DS unsupported | `3782 822463 10005` | `pm_card_amex_threeDSecureNotSupported` | 按 Stripe 策略继续，不假装已认证 |
| 3DS frictionless | `4000 0000 3220 0000` | — | 无交互完成认证 |
| Always authenticate | `4000 0027 6000 3184` | `pm_card_authenticationRequired` | 每次交易均认证 |
| Auth then insufficient funds | `4000 0082 6000 3178` | `pm_card_authenticationRequiredChargeDeclinedInsufficientFunds` | 认证后拒付 |
| Radar always blocked | `4100 0000 0000 0019` | `pm_card_radarBlock` | 不得 Paid |
| Radar highest risk | `4000 0000 0000 4954` | `pm_card_riskLevelHighest` | 结果随当前 Radar 配置记录 |
| Radar elevated risk | `4000 0000 0000 9235` | `pm_card_riskLevelElevated` | review/block 结果可解释 |
| CVC check fail | `4000 0000 0000 0101` | `pm_card_cvcCheckFail` | 按 Radar 配置处理 |
| Postal check fail | `4000 0000 0000 0036` | `pm_card_avsZipFail` | 按 Radar 配置处理 |
| Fraud dispute | `4000 0000 0000 0259` | `pm_card_createDispute` | 成功后创建 fraud dispute |
| Product not received dispute | `4000 0000 0000 2685` | `pm_card_createDisputeProductNotReceived` | 成功后创建 dispute |
| Inquiry | `4000 0000 0000 1976` | `pm_card_createDisputeInquiry` | 成功后创建 inquiry |
| Early fraud warning | `4000 0000 0000 5423` | `pm_card_createIssuerFraudRecord` | 成功后产生 warning |
| Async refund pending→success | `4000 0000 0000 7726` | `pm_card_pendingRefund` | refund.updated 最终成功 |
| Async refund later fails | `4000 0000 0000 5126` | `pm_card_refundFail` | refund.failed 恢复真实状态 |

## 2. 当前架构与关键端点

| 能力 | 当前实现/端点 |
|---|---|
| Order Checkout | `POST /api/payments/checkout-session/order`；Customer/Guest token/餐厅角色授权 |
| Public Cart payment | Public Cart payment-session API；与 order route 共用安全复用语义 |
| Return confirm | `POST /api/payments/stripe/checkout-session/confirm`；匿名、限流、只返回最小支付状态 |
| Webhook | `POST /api/payments/stripe/webhook`；平台与 connected account 两个 signing secret |
| Manual sync | `POST /api/payments/{paymentId}/sync`；AdminApi、租户限制 |
| Recovery worker | Pending 2 分钟后可查；5 分钟 cooldown；每批 25；每分钟扫描 |
| Connect model | 餐厅 connected account direct charge；可选 application fee |
| Payment states | Pending/Paid/Failed/Cancelled/Expired/PartiallyRefunded/Refunded/NotRequired |
| Result pages | `/payment/success`、`/payment/cancelled`；success 校验 `cs_` Session，并有 bounded polling / Check again |

## 3. 推荐夹具

| 夹具 | 最低要求 |
|---|---|
| 角色 | Customer A/B；Guest A/B；PlatformOwner；餐厅 A/B Owner/Admin/Staff |
| 餐厅 | A/B 独立 Sandbox connected account；Unconfigured；onboarding incomplete；charges disabled |
| 订单 | Takeaway/DineIn；Online/PayAtCounter；空单、正常单、已付、失败、取消、拒绝、已完成 |
| 金额 | $0、$0.01、普通金额、极大合法值、超过 Stripe 上限、含 options/discount/surcharge/GST |
| 币种 | AUD + 至少一种非 AUD；零小数货币只有在产品宣称支持时执行 |
| 故障 | Stripe CLI、可暂停 webhook、可重放/乱序事件、代理 429/500/502/timeout、可控 DB SaveChanges 失败 |
| 会话 | 两浏览器、两标签、移动 Safari/Chrome、后台休眠/恢复 |
| 对账 | connected account Dashboard、平台 fee、数据库、Audit/Event、Admin Payments、订单四页面 |

## 4. 前置与环境（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-PRE-01 | P0 | 目标环境 | 记录 URL、分支、提交、时区、端点 | 明确 Local/Test/Staging；Production 不执行资金写入 | Auto |
| PS-PRE-02 | P0 | Stripe mode | 对照 key 前缀、环境 API、Dashboard Sandbox | 三处均 Test 才继续 | Assisted |
| PS-PRE-03 | P0 | Connected account | 记录餐厅 A/B account 末四位与归属 | direct charge 不串店；报告不保存完整 ID | Auto |
| PS-PRE-04 | P0 | Webhook | 核对平台与 Connect destination/secret 分离及订阅事件 | 两类事件均能验签，secret 不输出 | Assisted |
| PS-PRE-05 | P1 | 回跳 URL | 记录 success/cancel URL 与前端 origin | HTTPS/同环境；`{CHECKOUT_SESSION_ID}` 未被编码破坏 | Auto |
| PS-PRE-06 | P0 | 一次性订单 | 为成功、各失败、3DS、退款、争议、并发分配独立订单 | 用例互不污染 | Auto |
| PS-PRE-07 | P0 | 基线 | 导出 Order/Payment/Refund/Event/Audit/库存/打印基线 | 可逐笔核对；证据脱敏 | Auto |
| PS-PRE-08 | P1 | 测试数据 | 确认卡号来自 Stripe 官方测试页 | 不输入真实卡；自动化优先 pm_card_* | Auto |
| PS-PRE-09 | P1 | 时间控制 | 记录服务端 UTC、餐厅时区、worker 周期 | 延迟/过期用例有可解释基线 | Auto |
| PS-PRE-10 | P0 | 外部副作用 | 关闭或定向测试打印/邮件/通知 | 不误打真实厨房、不发给真实顾客 | Assisted |

## 5. 角色、订单访问与租户隔离（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-ROLE-01 | P0 | Customer A | 为自己的订单创建 Session | 成功且只能访问自己的订单 | Auto |
| PS-ROLE-02 | P0 | Customer A + B orderId | 创建/确认 B 支付 | 403/404；B 无 Payment 变化 | Auto |
| PS-ROLE-03 | P0 | Guest 正确 token | 创建 Session | 成功；token 不出现在 Checkout metadata/日志 | Auto |
| PS-ROLE-04 | P0 | Guest 缺失/错误/别单 token | 创建 Session | 401/403；不泄露订单内容 | Auto |
| PS-ROLE-05 | P0 | Staff/Admin A | 为本店订单创建/同步 | 仅按授权能力成功；仍限 A | Auto |
| PS-ROLE-06 | P0 | Admin A + B paymentId | 手工 sync | 403；B LastSyncedAt 不变 | Auto |
| PS-ROLE-07 | P0 | PlatformOwner | 分别选 A/B 操作 | 使用目标 connected account；不跨店混合 | Auto |
| PS-ROLE-08 | P1 | 未登录普通订单 | 无 token 调 Checkout | 401 且提示登录，不确认订单是否存在 | Auto |
| PS-ROLE-09 | P1 | 畸形/不存在 UUID | Checkout/sync | 400/404；无 SQL/堆栈/枚举信息 | Auto |
| PS-ROLE-10 | P0 | 账号支付中被禁用/订单访问撤销 | 返回/重试/同步 | 当前授权重新判断；不能靠旧页继续创建新 Session | Assisted |

## 6. 支付资格与订单边界（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-ELIG-01 | P1 | Online Pending 正常订单 | 打开 Checkout | Online 可用且金额一致 | Auto |
| PS-ELIG-02 | P0 | PayAtCounter | 直接调线上 Checkout | 409；不创建 Stripe Payment | Auto |
| PS-ELIG-03 | P0 | Paid/PartiallyRefunded/Refunded/NotRequired | 逐项创建 Session | 全部拒绝重复收费 | Auto |
| PS-ELIG-04 | P0 | Cancelled/Rejected | 创建 Session | 拒绝；不改变订单状态 | Auto |
| PS-ELIG-05 | P1 | Completed 但未付异常数据 | 创建 Session | 按产品规则明确拒绝/修复，不静默收款 | Auto |
| PS-ELIG-06 | P0 | 空订单/总额 0 | UI/API 创建 Session | 拒绝；无 $0 Stripe Session | Auto |
| PS-ELIG-07 | P0 | 订单商品/金额在支付前变化 | 旧 Checkout 页面点 Pay | 重新以服务器快照校验；不得按陈旧金额收费 | Auto |
| PS-ELIG-08 | P0 | 餐厅暂停/关闭/删除 | 已有未付订单支付 | 已创建订单的付款策略明确且审计；不误创建新订单 | Assisted |
| PS-ELIG-09 | P1 | Stripe 未配置/onboarding 未完成/charges disabled | 打开并调 Checkout | 线上入口不可用；短可行动提示；PayAtCounter 不受误伤 | Auto |
| PS-ELIG-10 | P0 | 跨餐厅异常 order/restaurants 数据 | 创建 Session | 拒绝；metadata、currency、account 不混用 | Auto |

## 7. Checkout Session 创建与浏览器交接（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-SESSION-01 | P1 | Customer order | 点击 Pay online | 创建一个 Pending Payment 与 Checkout URL | Auto |
| PS-SESSION-02 | P1 | Guest cart | Public payment session | 保留 order/guest scope；进入同一订单 | Auto |
| PS-SESSION-03 | P0 | Direct charge | 查 Stripe Dashboard | Session/Intent/Charge 在餐厅 connected account | Assisted |
| PS-SESSION-04 | P0 | Metadata | 核对 orderId/paymentId/restaurantId/mode | 值一致且无 token、PAN、备注或敏感资料 | Auto |
| PS-SESSION-05 | P0 | Line items | 对比数量、单价、options 后总额 | Stripe 合计逐分等于订单应收 | Auto |
| PS-SESSION-06 | P1 | Customer email 有/无 | 创建 Session | 有则最小必要预填；无则可在 Stripe 输入；不串人 | Assisted |
| PS-SESSION-07 | P1 | returnTo 合法菜单路径 | 成功/取消返回 | 回到同餐厅合法路径 | Auto |
| PS-SESSION-08 | P0 | returnTo 外部/后台/协议相对/编码绕过 | 创建 Session | 归一化到安全本地菜单路径，无开放重定向 | Auto |
| PS-SESSION-09 | P1 | Popup 允许/阻止 | 点击 Pay | 新标签或当前页交接均可恢复；不丢订单 | Assisted |
| PS-SESSION-10 | P1 | Stripe 创建 Session 失败 | 注入 400/429/500/timeout | Payment/Order 为诚实可恢复状态；无孤立第二订单 | Auto |

## 8. 成功卡、品牌与 Hosted Checkout（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-CARD-01 | P0 | Visa 4242 | 完成支付 | Result、Order、Payment、Stripe 均 Paid | Assisted |
| PS-CARD-02 | P1 | Visa debit | 完成支付 | 品牌/资金状态正确，不影响总额 | Assisted |
| PS-CARD-03 | P1 | Mastercard/2-series | 分别支付 | 两者成功且识别正确 | Assisted |
| PS-CARD-04 | P1 | Amex | 4 位 CVC 完成支付 | 表单接受；金额/状态一致 | Assisted |
| PS-CARD-05 | P2 | Discover/Diners/JCB | 支持时逐项支付 | 支持能力与 Stripe/商户配置一致 | Assisted |
| PS-CARD-06 | P2 | UnionPay | 尝试支付 | 若当前 Checkout/地区不支持，清楚拒绝且 DineFlow 不误报失败 | Assisted |
| PS-CARD-07 | P1 | AU eftpos co-brand 两张 | 分别支付 | 成功；connected account 与 fee 正确 | Assisted |
| PS-CARD-08 | P1 | Billing name/email/postcode | 正常与 Unicode/长值 | Stripe 校验正常；DineFlow 只保存必要字段 | Assisted |
| PS-CARD-09 | P1 | Hosted Checkout Back/Refresh | 支付前刷新、返回、再次进入 | 原 Session 可复用；不重复 Payment | Assisted |
| PS-CARD-10 | P0 | 成功后刷新/回退 Stripe 页 | 多次操作 | 不能再次扣款；返回同一结果或明确已完成 | Assisted |

## 9. Decline 与无效输入（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-DECLINE-01 | P0 | Generic decline 0002 | 提交并重试成功卡 | 首次绝不 Paid；同订单可安全成功 | Assisted |
| PS-DECLINE-02 | P0 | Insufficient funds 9995 | 提交 | 简短可行动文案；内部 code 可审计但不泄露原始响应 | Assisted |
| PS-DECLINE-03 | P0 | Lost/stolen 9987/9979 | 分别提交 | 不履约、不自动取消错误订单；顾客文案不暴露风控细节 | Assisted |
| PS-DECLINE-04 | P1 | Expired 0069 | 提交 | 提示换卡；Session 仍可恢复 | Assisted |
| PS-DECLINE-05 | P1 | Incorrect CVC 0127 | 输入合法长度 CVC 后提交 | 正确触发 incorrect_cvc；可修改重试 | Assisted |
| PS-DECLINE-06 | P1 | Processing error 0119 | 提交、刷新、重试 | 不重复订单/Payment；可换卡 | Assisted |
| PS-DECLINE-07 | P1 | Velocity 6975 | 提交 | 不无限自动重试；说明稍后/换卡 | Assisted |
| PS-DECLINE-08 | P1 | Luhn 错误 4241 | 输入 | Stripe 表单就地拒绝；DineFlow 无支付终态副作用 | Assisted |
| PS-DECLINE-09 | P1 | month 13/year 95/CVC 99 | 分别输入 | 就地明确字段错误；不提交有效 Intent | Assisted |
| PS-DECLINE-10 | P0 | decline 后 webhook/return 乱序 | 先失败后迟到 completed 或反向 | 仅 Stripe 权威且匹配的最终状态生效；不得虚假 Paid | Auto |

## 10. 3DS、认证与取消（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-3DS-01 | P0 | Required 3220 | 完成 challenge | Paid；认证状态可在 Stripe 查 | Assisted |
| PS-3DS-02 | P0 | Required 3220 | 在 challenge 点 Fail | 不 Paid；同 Session/订单可重试 | Assisted |
| PS-3DS-03 | P0 | Required 3220 | 关闭 challenge/浏览器返回 | 不假装取消扣款；页面可恢复 | Assisted |
| PS-3DS-04 | P0 | Auth then decline 1629 | 完成认证 | 最终 Failed/未付；不因认证成功误标 Paid | Assisted |
| PS-3DS-05 | P1 | Lookup error 1280 | 提交 | 可换卡；无无限 spinner | Assisted |
| PS-3DS-06 | P1 | Optional 3055 | 支付 | 按 Stripe 决策成功；DineFlow 不强制错误 challenge | Assisted |
| PS-3DS-07 | P1 | Optional error 3097 | 触发认证 | 错误可恢复；状态诚实 | Assisted |
| PS-3DS-08 | P1 | Frictionless 32200000 | 支付 | 无人工 challenge 也能确认认证成功 | Assisted |
| PS-3DS-09 | P1 | Unsupported Amex | 支付 | 按 Stripe 策略继续；不伪造 3DS 结果 | Assisted |
| PS-3DS-10 | P0 | Auth 后掉线/多标签回跳 | 恢复并确认 | 同一 Payment 收敛；不重复扣款或通知 | Assisted |

## 11. 成功/取消结果页与轮询（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-RESULT-01 | P0 | 合法 `cs_` success URL | 返回页面 | Confirming→Confirmed；唯一 H1 与明确下一步 | Auto |
| PS-RESULT-02 | P0 | `{CHECKOUT_SESSION_ID}` 字面值/被编码 | 打开 success | 不无限 spinner；提示无法本页确认且后台仍会同步 | Auto |
| PS-RESULT-03 | P1 | 缺 session_id/错误前缀 | 打开 success | 不请求 Stripe；不泄露内部信息 | Auto |
| PS-RESULT-04 | P0 | session 不存在/别 account | confirm API | 最小 404/错误；不返回订单或顾客资料 | Auto |
| PS-RESULT-05 | P1 | Pending 多次 | 让 confirm 未确认到预算结束 | bounded backoff；显示 Payment received/processing 与 Check again | Auto |
| PS-RESULT-06 | P1 | Check again | 后台变 Paid 后点击 | 收敛 Confirmed；停止轮询 | Auto |
| PS-RESULT-07 | P1 | Tab 后台/恢复 | 轮询期间切后台再回来 | visibilitychange 自动再查；无并行重复请求 | Assisted |
| PS-RESULT-08 | P1 | StrictMode/remount/刷新 | success 页面重挂载 | 不丢确认、不永远锁住 running flag | Auto |
| PS-RESULT-09 | P1 | Cancel URL | 从 Stripe Cancel 返回 | 明确 No payment was taken；可返回订单重试 | Assisted |
| PS-RESULT-10 | P0 | 已扣款但 return/confirm 都丢失 | 只保留 webhook/worker | Order 最终 Paid；顾客下次查看一致 | Assisted |

## 12. Webhook、验签、幂等与乱序（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-WEB-01 | P0 | 无效签名/无 secret | POST webhook | 400/503；不写 Event/Payment/Order | Auto |
| PS-WEB-02 | P0 | 平台 secret 签 Connect event/反向 | 发送 | 只接受匹配 destination；不串模式 | Auto |
| PS-WEB-03 | P0 | 相同 event.id 重放 2–10 次 | 重放 | Event、状态、通知、自动接单、打印各最多一次 | Auto |
| PS-WEB-04 | P0 | 并发重复 event | 同时 POST | 唯一约束/事务保证一个生效；其余安全 2xx/幂等 | Auto |
| PS-WEB-05 | P0 | account 不等于 Payment.StripeAccountId | 发送有效签名事件 | 忽略并告警；不改别店 Payment | Auto |
| PS-WEB-06 | P0 | completed/async succeeded/payment_intent.succeeded | 逐项发送 | Paid 单向收敛；PaidAt/Intent/Charge 正确 | Auto |
| PS-WEB-07 | P0 | async failed/payment_intent.failed/canceled/session expired | 逐项发送 | 映射 Failed/Cancelled/Expired；无履约 | Auto |
| PS-WEB-08 | P0 | 新 Paid 后旧 Pending/Failed；Refunded 后 Paid | 乱序发送 | provider event 时间与状态策略阻止回退 | Auto |
| PS-WEB-09 | P1 | 未知事件/缺 metadata/对象不存在 | 发送 | 安全忽略并记录可诊断日志；返回策略稳定 | Auto |
| PS-WEB-10 | P0 | Stripe 成功后 DB SaveChanges/响应失败 | 重试同事件 | 最终一次提交；不重复 Payment/OrderEvent/Audit | Auto |

## 13. Payment 状态、金额、币种与费用（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-STATE-01 | P0 | 正常成功 | 对照 Stripe/DB/API/UI | Pending→Paid 单向；Order.PaymentStatus 同步 | Auto |
| PS-STATE-02 | P0 | 失败/取消/过期后重试成功 | 完整流程 | 旧失败尝试保留历史；当前支付清楚；不重复收入 | Assisted |
| PS-STATE-03 | P0 | Paid 后失败事件 | 发送旧/新失败 | Paid 不回退 | Auto |
| PS-STATE-04 | P0 | Refunded/Partial 后支付事件 | 重放 succeeded | 退款状态不回退为 Paid | Auto |
| PS-STATE-05 | P0 | 普通金额/options/数量 | 对比 cents | Order total=Session total=Intent amount=Payment amount | Auto |
| PS-STATE-06 | P0 | $0.01、二进制小数、10.005 | 创建 Checkout | 最小单位转换正确；非法精度拒绝 | Auto |
| PS-STATE-07 | P0 | AUD/非 AUD | 分别支付 | currency 在 Order/Session/Payment/Refund/receipt 一致 | Assisted |
| PS-STATE-08 | P0 | 多币种汇总 | PlatformOwner 查看 | 分币种展示；不直接相加 | Auto |
| PS-STATE-09 | P0 | application fee 0/边界/正常 bps | 支付 | fee 精确、不过总额、只进平台；direct charge 归餐厅 | Assisted |
| PS-STATE-10 | P1 | Stripe fee/net/receipt URL | 支付后 sync | fee+net 与 charge balance transaction 对账；未同步不显示 0 冒充 | Assisted |

## 14. Session 复用、幂等与并发（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-IDEM-01 | P0 | 快速双击 Pay | 连点/Enter | 一个有效 Checkout Session/Payment | Auto |
| PS-IDEM-02 | P0 | 顺序重放创建请求 | 同订单重复 POST | 复用 live Session；不新增可收费尝试 | Auto |
| PS-IDEM-03 | P0 | 两标签并发创建 | 同时请求 | 同一 live Session 或明确冲突；不双扣 | Auto |
| PS-IDEM-04 | P0 | 两设备 Customer/Guest | 同一订单支付 | 只有一笔有效收入；另一端及时收敛已付 | Assisted |
| PS-IDEM-05 | P0 | 已完成 Stripe Session 本地仍 Pending | 再点 Pay | 先同步为 Paid；拒绝创建第二 Session | Auto |
| PS-IDEM-06 | P0 | Stripe 检查 timeout/502 | 再点 Pay | 保留原 URL/idempotency key；绝不猜测创建新 Session | Auto |
| PS-IDEM-07 | P0 | Session expired | 再点 Pay | 旧 Payment 标 Expired；轮换 idempotency key；仅一个新 Session | Auto |
| PS-IDEM-08 | P0 | 创建 Stripe 成功但本地响应丢失 | 客户重试 | 通过 idempotency/对账找回原 Session | Auto |
| PS-IDEM-09 | P0 | Paid 同时取消/改 PayAtCounter/订单状态改变 | 并发提交 | 资金事实优先且冲突明确；不出现 Paid+柜台应收 | Auto |
| PS-IDEM-10 | P0 | Worker/return/webhook/manual sync 同时处理 | 并发触发 | 最终一个状态、一组副作用、审计来源可解释 | Auto |

## 15. 退款、异步退款与外部退款（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-REF-01 | P0 | Paid Sandbox | 全额退款 | connected account/DineFlow/Order/Audit 一致 | Assisted |
| PS-REF-02 | P0 | 多商品 | 按商品部分退款 | allocation 与金额逐分正确；状态 Partial | Assisted |
| PS-REF-03 | P0 | 多次部分至全额 | 连续退款 | 累计不超原款；最终 Refunded | Assisted |
| PS-REF-04 | P0 | 0/负数/超余额/错币种 | API 退款 | 400/409；Stripe 无退款 | Auto |
| PS-REF-05 | P0 | 双击/并发/超时重试 | 提交退款 | 同幂等键一笔 Stripe refund/DB row/通知 | Assisted |
| PS-REF-06 | P0 | Async success 7726 | 发起退款并等 refund.updated | Pending→Succeeded；请求/订单状态收敛 | Assisted |
| PS-REF-07 | P0 | Async failure 5126 | 发起并等 refund.failed | 不保留虚假成功；余额恢复可退；可安全重试 | Assisted |
| PS-REF-08 | P0 | Stripe Dashboard 外部退款/charge.refunded | 创建并投递事件 | DineFlow 补建/更新退款；余额与状态正确 | Assisted |
| PS-REF-09 | P0 | application fee | 部分/全额退款 | 按策略返还 fee；平台与 connected account 对账 | Assisted |
| PS-REF-10 | P0 | 全额退款不同厨房状态 | Pending/Accepted/Ready/Completed | 仅允许的早期单关闭；不重写已制作/已完成历史 | Auto |

## 16. Radar、争议与风险事件（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-RISK-01 | P0 | Radar block 0019 | 支付 | 不 Paid；DineFlow 可恢复且不泄露规则 | Assisted |
| PS-RISK-02 | P1 | highest/elevated risk | 分别支付 | 结果与当前 Radar 配置一致并记录测试配置 | Assisted |
| PS-RISK-03 | P1 | CVC/AVS fail cards | 支付 | check/risk 结果可同步；顾客提示不暴露内部规则 | Assisted |
| PS-RISK-04 | P0 | Fraud dispute 0259 | 支付并等 dispute.created | Dispute 状态、金额、deadline、connected account 正确 | Assisted |
| PS-RISK-05 | P0 | Product not received 2685 | 支付并等事件 | 类别与支付匹配；不误自动退款 | Assisted |
| PS-RISK-06 | P1 | Inquiry 1976/Early warning 5423 | 分别支付 | 类型正确；管理端动作/提示不混淆 dispute | Assisted |
| PS-RISK-07 | P0 | dispute updated/closed won | 提交 `winning_evidence` | 状态/资金/审计收敛；不改订单履约历史 | Assisted |
| PS-RISK-08 | P0 | dispute closed lost | 提交 `losing_evidence` | 损失与 fee 如实报告；不冒充 customer refund | Assisted |
| PS-RISK-09 | P0 | 重复/乱序 dispute 事件 | 重放 | 单一记录不回退；无重复通知 | Auto |
| PS-RISK-10 | P0 | 别 connected account dispute | 发送有效事件 | 拒绝/忽略；不泄露或修改他店支付 | Auto |

## 17. 订单、厨房、通知、收据与报表联动（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-SIDE-01 | P0 | Online Pending/Failed/Cancelled/Expired | 看 Staff Orders | 全部 Payment holds；不可厨房处理 | Auto |
| PS-SIDE-02 | P0 | Paid | 看 Kitchen/Staff/Admin/My/Front | 同一订单只出现一次并可履约 | Assisted |
| PS-SIDE-03 | P1 | Auto accept on/off | 支付成功 | 按餐厅配置一次接受或等待；不重复 history | Auto |
| PS-SIDE-04 | P0 | 支付事件重放 | 查 SignalR/通知/声音/打印 | 每类副作用至多一次 | Assisted |
| PS-SIDE-05 | P1 | Guest/Customer success | 查收据/邮件 | 金额、币种、餐厅身份、GST、退款联系一致 | Assisted |
| PS-SIDE-06 | P1 | 邮件失败 | 支付成功但通知失败 | 支付仍 Paid；邮件可重试；不重扣 | Assisted |
| PS-SIDE-07 | P0 | Partial/Full refund | 看所有订单页 | payment badge、可履约策略、余额一致 | Auto |
| PS-SIDE-08 | P1 | Dispute | 看 Admin Payments/Reports | 争议信息出现；不把 dispute 当 refund/revenue | Auto |
| PS-SIDE-09 | P1 | 指标/导出 | 对比收入、fee、net、refund | 只统计权威成功状态；分币种 | Auto |
| PS-SIDE-10 | P1 | 时间 | 对比 Created/Paid/Failed/Refunded/Webhook/Sync | 使用真实事件时间；餐厅/浏览器时区显示明确 | Auto |

## 18. 安全、隐私、合规与故障恢复（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-SEC-01 | P0 | 配置/构建 | 搜前端 bundle、日志、错误 | 无 secret/whsec；只使用可公开 key/Hosted URL | Auto |
| PS-SEC-02 | P0 | confirm API | 枚举 `cs_`、爆破、跨 account | 限流；最小响应；不返回订单/顾客/金额 | Auto |
| PS-SEC-03 | P0 | Checkout URL/token | Referer、日志、截图、分析事件 | 不记录完整 token/Session 或敏感 query | Assisted |
| PS-SEC-04 | P0 | Webhook payload | 恶意 metadata/超大 body/错误 JSON | 有上限、安全拒绝；无注入/堆栈 | Auto |
| PS-SEC-05 | P0 | returnTo | `https:`, `//`, encoded traversal, CRLF | 无开放重定向/header 注入 | Auto |
| PS-SEC-06 | P1 | PCI 边界 | 检查应用 DOM/API/DB/log | DineFlow 不接收/存储 PAN/CVC；卡输入只在 Stripe 托管页 | Auto |
| PS-SEC-07 | P1 | 隐私 | 顾客邮件/账单资料/收据 | 最小必要收集；角色与保留策略明确 | Auto |
| PS-SEC-08 | P1 | 400/401/403/404/409/429/500/502/503 | 逐项注入 | 短可行动信息+correlation；无 SQL/secret/Stripe 原始对象 | Auto |
| PS-SEC-09 | P0 | Stripe 429/timeout/宕机 | 创建/确认/sync/refund | 不猜成功、不双写；指数退避/人工重试边界明确 | Assisted |
| PS-SEC-10 | P0 | 收尾 | 对照基线与 Dashboard | 无孤立 Processing/Pending、无重复收入；Sandbox 动作清单与证据脱敏 | Assisted |

## 19. 恢复、移动端、无障碍与自动化门槛（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PS-REC-01 | P1 | 390/430px Safari/Chrome | 下单→Hosted Checkout→3DS→结果页 | 无遮挡/横向溢出；返回路径可靠 | Assisted |
| PS-REC-02 | P1 | 200% zoom/键盘 | 完成支付/取消/Check again | 焦点可见、顺序合理、无陷阱 | Assisted |
| PS-REC-03 | P1 | 屏幕阅读器 | 读取金额、错误、processing、confirmed | 标题/状态成组；动态变化可感知且不重复播报 | Assisted |
| PS-REC-04 | P1 | Reduced motion/high contrast | 结果页与错误 | 不只靠颜色/动画；spinner 有文本 | Assisted |
| PS-REC-05 | P1 | 浏览器崩溃/设备重启 | 支付前后分别恢复 | 服务器真相优先；不会再次扣款 | Assisted |
| PS-REC-06 | P1 | Worker | Pending 超 2 分钟、cooldown 5 分钟、>25 条 | 批量有界、公平、不过度调用 Stripe | Auto |
| PS-REC-07 | P0 | 自动化单测 | 运行 Checkout reuse、return URL、state policy、result polling | 全部通过，无关键 skip | Auto |
| PS-REC-08 | P0 | PostgreSQL 集成 | 运行支付/退款/webhook/idempotency 并发 | 原子、唯一约束、租户和回滚全部通过 | Auto |
| PS-REC-09 | P1 | Stripe CLI 集成 | 在 Sandbox 自动创建/回放事件 | fixture 可重复、ID 脱敏、失败可清理 | Assisted |
| PS-REC-10 | P0 | 结束判定 | 汇总 160 条与相邻包结果 | P0=0 才可建议进入受控 Live 验收；Sandbox PASS 不等于生产收款通过 | Auto |

## 20. 推荐执行顺序

1. `PS-PRE-*`、`PS-ROLE-*`、`PS-ELIG-*`：确认环境、归属与支付资格。
2. `PS-SESSION-*`、`PS-CARD-*`：一笔最小成功支付，先证明 direct charge 与回跳。
3. `PS-DECLINE-*`、`PS-3DS-*`、`PS-RESULT-*`：失败、认证、取消和恢复。
4. `PS-WEB-*`、`PS-STATE-*`、`PS-IDEM-*`：验签、乱序、状态单向、重复与并发。
5. `PS-REF-*`、`PS-RISK-*`：使用各自一次性订单执行不可逆 Sandbox 动作。
6. `PS-SIDE-*`：核对 Staff/Front/Admin/My Orders、通知、收据与报表。
7. `PS-SEC-*`、`PS-REC-*`：安全错误、故障、移动/无障碍、自动化和清理。

## 21. 完成标准

- 160 个 `PS-*` 被选择的每一条均记录 PASS/FAIL/BLOCKED/NOT RUN；不能用“Stripe 页面成功”替代 DineFlow 对账。
- P0 必须为 0：Live 误操作、跨租户、金额/币种错误、错误 connected account、重复扣款/退款、Webhook 验签/幂等失败、状态回退、支付未成却进入厨房、敏感数据泄露均为发布阻断。
- 每笔成功支付在 Customer result、Order、Payment、connected account、application fee、Webhook/Event/Audit 与相关工作台一致。
- 每笔 decline/3DS cancel/error 都未产生虚假 Paid、自动接单、打印或收入。
- 每笔退款/争议状态和余额真实、单向、可恢复，且不超原始收入。
- Sandbox 全通过仍不等于 Production 验收；Live 只能在另行批准的低金额、真实卡、监控/退款/对账齐备的受控窗口执行。
