# DineFlow Admin Payments 专项测试用例

测试包名称：`admin-payments`  
稳定用例前缀：`PAY-*`  
页面：`/admin/payments`  
用例总数：166  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-payments`、某个 `PAY-*` 用例或明确要求 `full` 时才执行。

本包覆盖支付管理页的 Orders、Refund requests、Refund history 三个视图，以及 Checkout 恢复、Stripe 状态同步、结算手续费与净额、收据、争议、直接退款、顾客退款请求审批和 CSV 导出。

相邻测试包，不在本包重复完整覆盖：

- 顾客结账、官方测试卡、支付结果页、Webhook 与端到端资金状态 → [Payment System 专项](payment-system-test-cases.md)
- 订单厨房流转、柜台收款与 SLA → [admin-orders-test-cases.md](admin-orders-test-cases.md)
- 餐厅 Stripe Connect 开通、收费设置和商户资料 → [admin-restaurants-test-cases.md](admin-restaurants-test-cases.md)
- 支付事件报告、审计导出与保留期限 → Admin Reports / `privacy-legal`

## 1. 执行与资金安全规则

- **任何创建 Checkout、退款、批准退款、重放 webhook 或发送收据的步骤，只能在 Stripe Sandbox/Test 与一次性测试订单中执行。**
- Production 默认只读。即使页面显示 Live，除非用户另行明确授权，也不得点击 Checkout、Refund、Approve、Resend receipt 或重放事件。
- 测试前记录 Payment、PaymentRefund、PaymentRefundItem、PaymentRefundRequest、PaymentEventLog、AuditLog 与 Order.PaymentStatus 基线；测试后核对，已发生的 Sandbox 退款不能“回滚”，必须在报告登记。
- 每笔资金动作都必须核对 DineFlow、Stripe connected account、订单、退款记录与审计；报告和截图对完整 Stripe ID、顾客邮箱与订单访问 Token 打码。
- 直接退款与退款请求批准均视为不可逆操作：快速双击、并发、超时重试、掉线恢复和 webhook 重放必须验证幂等。
- 只允许使用 Stripe 官方测试支付方式，不输入真实卡、真实身份、税号或银行资料。
- 本文件只定义用例；本轮不会启动浏览器、Stripe、邮箱或数据库写操作。

## 2. 页面端点与授权

| 能力 | 端点 | 授权/说明 |
|---|---|---|
| 环境标识 | `GET /api/payments/environment` | AdminApi；Test/Live/Unconfigured |
| 支付列表 | `GET /api/payments` | AdminApi；租户范围、筛选、排序、分页 |
| 退款历史 | `GET /api/payments/refunds` | AdminApi |
| 退款汇总 | `GET /api/payments/refunds/summary` | AdminApi |
| 顾客退款请求 | `GET /api/payments/refund-requests` | AdminApi |
| 批准/拒绝请求 | `POST /api/payments/refund-requests/{id}/approve`、`.../reject` | AdminApi；不可逆/需审计 |
| 手工同步 | `POST /api/payments/{id}/sync` | AdminApi；从 Stripe 拉权威状态 |
| 重发收据 | `POST /api/payments/{id}/receipt/resend` | AdminApi |
| 管理端订单与汇总 | `GET /api/admin/orders` / `summary` | AdminApi；页面 Orders 视图来源 |
| 管理端直接退款 | `POST /api/admin/orders/{id}/refund` | AdminApi |
| Checkout | `POST /api/payments/checkout-session/order` | 订单访问控制 + Stripe |
| 顾客返回恢复 | `POST /api/payments/stripe/checkout-session/confirm` | 匿名但限流，只返回最小状态 |
| Stripe webhook | `POST /api/payments/stripe/webhook` | 匿名；必须验签与幂等 |

## 3. 推荐夹具

| 夹具 | 最低要求 |
|---|---|
| 角色 | PlatformOwner；餐厅 A/B 各 Owner/Admin/Staff；Customer；Guest |
| 餐厅 | A/B 均有独立 Stripe Sandbox connected account；另有 1 家 Unconfigured |
| 订单矩阵 | Online 未付/Pending/Paid/Failed/Cancelled/PartiallyRefunded/Refunded；PayAtCounter |
| 支付矩阵 | 有/无 Checkout Session、PaymentIntent、Charge、Receipt、Email、手续费、平台费 |
| 退款矩阵 | Pending/Succeeded/Failed；整单/按商品/一般调整；多次部分退款 |
| 退款请求 | Pending/Processing/Approved/Rejected/Cancelled；有无商品明细 |
| 争议 | Stripe Test dispute，含原因、金额、证据截止时间 |
| 多币种 | AUD + 至少一种非 AUD；汇总不得跨币种相加 |
| 故障控制 | Stripe CLI/Test Clock 或可控 webhook；后端日志；可暂停 webhook |
| 邮箱 | 只在明确执行收据/通知用例时使用专用测试邮箱 |

## 4. 前置检查（8）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-PRE-01 | P0 | 目标环境 | 记录 URL、分支、提交、时区和服务端点 | 明确 Local/Test/Staging；不得误操作 Production | Auto |
| PAY-PRE-02 | P1 | 工作区 | 记录 dirty、Node/.NET/容器版本 | 不覆盖用户变更；命令可复现 | Auto |
| PAY-PRE-03 | P0 | Stripe | 同时核对后端 key 模式、页面环境徽标与 Stripe Dashboard | 三处均为 Test/Sandbox 才允许资金写操作 | Assisted |
| PAY-PRE-04 | P0 | connected accounts | 解析餐厅 A/B 的 StripeAccountId | 归属明确；不得把平台账户当 connected account | Auto |
| PAY-PRE-05 | P0 | 角色账号 | 解析角色、userId、restaurantId | A/B 租户边界明确 | Auto |
| PAY-PRE-06 | P0 | 数据库 | 导出订单/支付/退款/请求/事件/审计基线 | 可逐笔对账；不包含报告不需要的敏感值 | Auto |
| PAY-PRE-07 | P1 | 外部控制 | 确认 Stripe CLI/webhook 日志和测试邮箱是否可用 | 缺少的依赖提前标为 NOT RUN，不临时改用真实系统 | Assisted |
| PAY-PRE-08 | P0 | 一次性数据 | 为 Checkout、直接退款、审批、并发各建独立订单 | 用例互不污染；每个幂等键可追踪 | Auto |

## 5. 页面、标签、URL 与加载恢复（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-PAGE-01 | P1 | 正常网络 | 打开 `/admin/payments` | 唯一 H1；默认 Orders；环境徽标、摘要和列表完成加载 | Auto |
| PAY-PAGE-02 | P1 | 三标签 | 依次切 Orders/Refund requests/Refund history | 每次只加载当前视图；标题、计数与操作匹配 | Auto |
| PAY-PAGE-03 | P1 | 合法深链 | 带 view/q/from/to/status/restaurant/page/sort 参数直接打开并刷新 | UI 与 URL 完整恢复；不会先闪现别店或默认数据 | Auto |
| PAY-PAGE-04 | P1 | 浏览历史 | 改筛选、标签后使用后退/前进 | URL、标签、页码和结果一致 | Auto |
| PAY-PAGE-05 | P1 | 非法 URL | 传非法 view/status/page/pageSize/sort/direction/date | 安全回落；无 500、NaN 或空白页；URL 可被修正 | Auto |
| PAY-PAGE-06 | P1 | 慢网络 | 首次加载三个标签 | 有稳定 Loading/Skeleton；旧数据不伪装成新结果 | Auto |
| PAY-PAGE-07 | P1 | 单项 API 失败 | 分别让列表、摘要、环境、餐厅目录失败 | 成功部分可用但不会伪装完整；短错误持久可重试 | Auto |
| PAY-PAGE-08 | P1 | Retry | 恢复失败 API 后点击重试/刷新 | 错误清除；数据和摘要统一恢复 | Auto |
| PAY-PAGE-09 | P1 | Refresh | 快速双击并在请求中再次点击 | 控件禁用；无重复请求、乱序覆盖或重复 toast | Auto |
| PAY-PAGE-10 | P1 | 快速切标签 | 慢请求中 Orders→History→Requests | 已取消响应不覆盖当前标签；无 Abort 错误 toast | Auto |
| PAY-PAGE-11 | P1 | 空数据 | 三标签分别返回 0 条 | 各有针对性空态和清筛选入口，不显示 0/0 异常页码 | Auto |
| PAY-PAGE-12 | P0 | 环境接口 | 返回 Test/Live/Unconfigured/失败 | 徽标与实际环境一致；未知时按 Unconfigured 禁止破坏性动作 | Auto |
| PAY-PAGE-13 | P1 | 多筛选 | 点击 Reset filters | 搜索、日期、状态、餐厅、页码、排序恢复默认；当前标签策略明确 | Auto |
| PAY-PAGE-14 | P1 | Export | 切换三个标签观察按钮 | 明确导出 Current view；加载/导出中不可重复触发 | Auto |

## 6. 路由、角色与租户隔离（12）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-ROLE-01 | P1 | Guest | 直接打开与刷新页面 | 跳转登录；无金额、邮箱或订单闪现 | Auto |
| PAY-ROLE-02 | P0 | Customer | 打开页面并直接调用所有 Admin payment API | 页面拒绝；API 403 | Auto |
| PAY-ROLE-03 | P0 | Staff A | 打开页面并调用列表、sync、receipt、refund、approve/reject | 页面拒绝；所有 AdminApi 403 | Auto |
| PAY-ROLE-04 | P1 | Admin/Owner A | 打开三标签 | 只看到 A 的订单、付款、退款、请求和汇总 | Auto |
| PAY-ROLE-05 | P0 | Admin A + B paymentId | 调用 sync 与 resend receipt | 403；B 的 LastSyncedAt/通知均不变 | Auto |
| PAY-ROLE-06 | P0 | Admin A + B orderId | Checkout 与直接退款 | 403；不创建 Payment/Refund | Auto |
| PAY-ROLE-07 | P0 | Admin A + B requestId | approve/reject | 403；B 的状态、note、审核人不变 | Auto |
| PAY-ROLE-08 | P0 | Admin A | 列表查询带 restaurantId=B | 403 或忽略为 A；绝不能返回 B 数据或数量 | Auto |
| PAY-ROLE-09 | P1 | PlatformOwner | 查看 All restaurants 并选 A/B | 可见平台范围；切店后所有标签、摘要和导出同时收窄 | Auto |
| PAY-ROLE-10 | P1 | 非平台角色无餐厅 | 打开/调用 API | 403 且提示未分配；不降级为全平台数据 | Auto |
| PAY-ROLE-11 | P1 | 畸形/不存在 ID | sync、receipt、refund、approve/reject | 400/404；无堆栈、SQL 或资源存在性泄漏 | Auto |
| PAY-ROLE-12 | P1 | 同浏览器切账号 | Admin A→Admin B→Customer | 缓存、展开行、筛选与请求全部按新身份重置 | Assisted |

## 7. 搜索、筛选、排序与分页（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-LIST-01 | P1 | Orders | 搜订单号、餐厅、顾客名/邮箱、PaymentId、SessionId、IntentId | 支持字段均命中；大小写与前后空格不影响 | Auto |
| PAY-LIST-02 | P1 | Requests/History | 搜请求/退款 ID、订单、餐厅、顾客、IntentId、理由 | 各标签搜索语义明确且结果正确 | Auto |
| PAY-LIST-03 | P1 | 特殊字符 | 搜 `%`、`_`、反斜杠、单引号、emoji、SQL 片段 | 按字面安全搜索；无通配放大、500 或注入 | Auto |
| PAY-LIST-04 | P1 | 长搜索 | 输入 200/201 字符并快速修改 | 200 可控；超限就地拒绝或 400；旧响应不覆盖 | Auto |
| PAY-LIST-05 | P1 | Payment status | 逐选 Pending/Paid/Failed/Cancelled/Refunded/PartiallyRefunded/NotRequired | 状态与 API/DB 一致 | Auto |
| PAY-LIST-06 | P1 | Order status/type | 逐项和组合筛选 | 取交集；标签与行状态一致 | Auto |
| PAY-LIST-07 | P0 | Payable only | 开启后再选 Paid/Refunded；或手改矛盾 URL | 不提供矛盾值或自动回落；不可对已付/已退款订单显示 Checkout | Auto |
| PAY-LIST-08 | P1 | Date from | 选餐厅本地某日 | 从该日 00:00 起包含，UTC 转换正确 | Auto |
| PAY-LIST-09 | P1 | Date to | 选择结束日 | 包含该本地整日，服务端使用次日 exclusive；边界毫秒不漏/不重 | Auto |
| PAY-LIST-10 | P1 | DST/时区 | Adelaide 夏令时切换日筛选 | 不按固定偏移误算；结果与餐厅/页面约定一致 | Assisted |
| PAY-LIST-11 | P1 | 日期非法 | from>to、无效日期、未来日期 | 就地提示或空结果策略明确；不发畸形 UTC | Auto |
| PAY-LIST-12 | P1 | 餐厅筛选 | PlatformOwner 选择 A/B/All | 列表、摘要、请求、历史和导出完全同范围 | Auto |
| PAY-LIST-13 | P1 | 组合筛选 | 搜索+日期+餐厅+多个状态 | 结果取交集；清单与汇总采用同一条件 | Auto |
| PAY-LIST-14 | P1 | 排序 | 逐列升/降序：created/order/restaurant/payment/order status/amount | 稳定排序；相同值有确定次序；URL 正确 | Auto |
| PAY-LIST-15 | P1 | 分页 | 10/20/50/100，首/中/末页与越界页 | 无重复/漏项；范围文案与 TotalItems 一致；越界安全回落 | Auto |
| PAY-LIST-16 | P1 | 请求竞态 | 连续搜索、排序、翻页、切餐厅 | 最后一次条件获胜；旧请求被取消且不覆盖 | Auto |

## 8. 汇总指标与多币种（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-SUM-01 | P1 | Orders | 对照 DB 核对 total/active/paid/pending/failed/payable | 每项定义一致；组合状态不误计 | Auto |
| PAY-SUM-02 | P1 | Orders 筛选 | 改搜索、日期、餐厅与状态 | 汇总与完整筛选集一致，不只统计当前页 | Auto |
| PAY-SUM-03 | P0 | 多币种收入 | 同时存在 AUD/NZD | 分币种展示，绝不把数值直接相加 | Auto |
| PAY-SUM-04 | P1 | Refund history | 核对 total/pending/succeeded/failed | 计数与完整数据一致 | Auto |
| PAY-SUM-05 | P0 | 多币种退款 | 核对各状态金额 | 每币种、每状态独立；cents 精确无浮点误差 | Auto |
| PAY-SUM-06 | P1 | 展开/收起摘要 | 三标签切换、刷新 | 状态可理解；不会混用 Orders 与 Refund 的摘要 | Auto |
| PAY-SUM-07 | P1 | 摘要 API 失败 | 列表成功、摘要失败后重试 | 不显示旧/零值冒充真实；列表仍可用 | Auto |
| PAY-SUM-08 | P1 | 0 与 null | 无付款、未同步手续费、无退款 | 显示 None/Not synced/0 的语义正确，不出现 NaN | Auto |

## 9. 表格、展开详情与标识符（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-DETAIL-01 | P1 | Orders | 点击行、Chevron、操作按钮 | 行可展开/收起；操作按钮不会误触展开 | Auto |
| PAY-DETAIL-02 | P1 | 商品快照 | 查看名称、数量、单价、选项、备注、行总额 | 与订单快照一致，不取当前菜单价格/名称 | Auto |
| PAY-DETAIL-03 | P0 | 金额 | 核对订单总额、charged、refunded、refundable | cents 与币种一致；满足 original=refunded+refundable 的适用关系 | Auto |
| PAY-DETAIL-04 | P1 | 标识符 | 长 Payment/Session/Intent/Charge/Refund ID | 页面紧凑显示、title 可查看；不撑破表格 | Auto |
| PAY-DETAIL-05 | P1 | Copy | 点击复制成功/权限拒绝 | 复制完整值；成功/失败短提示；不展开行 | Auto |
| PAY-DETAIL-06 | P0 | 日志/截图 | 收集证据与前端错误 | 完整 Stripe ID、订单 Token、邮箱被打码；服务器堆栈不进 toast | Assisted |
| PAY-DETAIL-07 | P1 | 无 payment | 展开未创建付款尝试的订单 | 明确 No attempt/session；不显示伪造的 0 手续费 | Auto |
| PAY-DETAIL-08 | P1 | 状态动作 | 遍历支付状态 | 只显示合法的 Checkout/Refund/Refund pending/Already paid/Not payable | Auto |
| PAY-DETAIL-09 | P1 | Demo ID | 展开 seeded demo payment | 不生成无效 Stripe 链接；Sync/Refund 受阻且说明原因 | Auto |
| PAY-DETAIL-10 | P0 | Stripe 深链 | Test/Live + connected account | URL 指向正确 acct、test/live、payments/disputes 资源；新标签有 noopener | Auto |
| PAY-DETAIL-11 | P1 | 退款记录 | 展开多笔部分退款 | 按状态、时间、项目分配、一般调整显示；失败理由不混为成功 | Auto |
| PAY-DETAIL-12 | P1 | PII | Customer/Staff/Admin/跨租户查看 | 只有授权管理员可见必要信息；列表不泄露超出用途的资料 | Auto |

## 10. Checkout 创建与顾客返回恢复（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-CHECK-01 | P0 | 合法 Online 未付订单 | 点击 Checkout | 只创建一个 Pending payment/session；跳转正确 connected account Test Checkout | Assisted |
| PAY-CHECK-02 | P0 | 不合法状态 | 对 Paid/Refunded/PartiallyRefunded/NotRequired/Cancelled/Rejected/PayAtCounter 调用 | UI 不提供；API 409/400；无新 Payment | Auto |
| PAY-CHECK-03 | P0 | 快速双击/两标签 | 同时创建 Checkout | 只保留一个可恢复尝试或明确幂等策略；不得造成双扣风险 | Assisted |
| PAY-CHECK-04 | P1 | Stripe 未配置/连接不完整 | 点击或调用 | 禁用或 503 短提示；订单保持可重试，不出现 500 | Auto |
| PAY-CHECK-05 | P1 | 在 Stripe 取消 | 返回 cancelled 后再从管理端重试 | 明确未付款；旧 attempt 不被误标 Paid；新尝试可追踪 | Assisted |
| PAY-CHECK-06 | P0 | 回跳 session_id | 合法/非法/不存在/别单 ID 调 confirm | 合法只返回最小状态；非法 400/404；限流；不泄露订单资料 | Auto |
| PAY-CHECK-07 | P0 | 延迟 webhook | Checkout 成功但暂停 webhook，使用回跳 confirm | 从 Stripe 恢复到 Paid且幂等；订单自动接受策略一致 | Assisted |
| PAY-CHECK-08 | P1 | Stripe 创建失败/超时 | 模拟 4xx/5xx/timeout | attempt 标记 Failed 或可恢复 Pending，原因可诊断；再次操作不双扣 | Assisted |

## 11. Stripe 同步、结算、收据与争议（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-SETTLE-01 | P1 | Pending/Failed | 展开详情 | 显示 stalled 警示与 Re-sync 建议，不宣称已支付 | Auto |
| PAY-SETTLE-02 | P1 | 无 Intent/demo Intent | 查看 Re-sync | 禁用并给出准确原因；不调用 Stripe | Auto |
| PAY-SETTLE-03 | P0 | 漏 webhook 的成功付款 | Re-sync | 拉到 Paid、更新 Order、PaidAt、Charge、Receipt、审计与实时通知 | Assisted |
| PAY-SETTLE-04 | P0 | 已退款状态 | Stripe 返回较旧 Paid/Pending 后 sync | Refunded/PartiallyRefunded 不回退 | Auto |
| PAY-SETTLE-05 | P1 | 未同步 | 查看 Stripe fee/net | 显示 Not synced，不能以 0 冒充 | Auto |
| PAY-SETTLE-06 | P0 | 已结算 direct charge | Re-sync 后核对 fee/platform fee/net | connected account 金额与页面/DB一致；公式和币种正确 | Assisted |
| PAY-SETTLE-07 | P1 | 时间字段 | 核对 Last webhook/Last synced | 使用真实事件时间与同步时间；时区显示清晰 | Auto |
| PAY-SETTLE-08 | P1 | 收据缺 URL/email | 查看 Resend | 禁用并解释；不得给未知收件人发信 | Auto |
| PAY-SETTLE-09 | P1 | 收据齐全 | 明确授权后重发一次并模拟失败 | 只发测试邮箱；成功/失败短提示；不重复轰炸；有审计/限流 | Assisted |
| PAY-SETTLE-10 | P0 | Dispute | 同步/接收 dispute.created | 页面显著展示金额、原因、状态与证据截止时间 | Assisted |
| PAY-SETTLE-11 | P0 | Dispute | 查看退款入口和 Stripe 链接 | 明确防止“双重损失”；链接进入正确 connected account dispute | Assisted |
| PAY-SETTLE-12 | P1 | Stripe 502/429/timeout | Re-sync/receipt | 页面可重试、不写错误终态、不显示堆栈；按钮恢复可用 | Assisted |

## 12. 管理员直接退款（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-REF-01 | P0 | 资格矩阵 | 遍历 Online Paid/PartiallyRefunded、Pending、Failed、PayAtCounter、demo、pending refund | 只有真实 Stripe 且有余额、无 pending 的付款可退款 | Auto |
| PAY-REF-02 | P0 | 全额 | Refund remaining balance | 精确退剩余余额；尽量归属到商品，差额明确为 general adjustment | Assisted |
| PAY-REF-03 | P0 | 按商品 | 选择一项与数量 | 只退所选数量/金额；其他项目余额不变 | Assisted |
| PAY-REF-04 | P0 | 数量边界 | 0、负数、小数、超过 refundableQuantity | 前后端拒绝；不创建 pending refund | Auto |
| PAY-REF-05 | P0 | 项目金额边界 | 0、负数、三位小数、超过项目余额/单价×数量 | 就地禁用且 API 拒绝；cents 不被意外四舍五入 | Auto |
| PAY-REF-06 | P1 | 一般调整 | 仅/同时填写 service credit 等 | 独立记录为 unattributed；说明用途；总额正确 | Assisted |
| PAY-REF-07 | P0 | 总额 | 项目+调整为 0、恰好余额、超过余额 | 0/超额拒绝；恰好余额成功且状态 Refunded | Auto |
| PAY-REF-08 | P0 | 重复项/API 绕过 | 同 orderItemId 重复、别单 itemId、已全退项目 | 整单拒绝；不得重复分配或跨订单退款 | Auto |
| PAY-REF-09 | P1 | 理由 | 空白、trim、1000/1001、HTML/换行 | 可选且 trim；超长拒绝；安全显示；内部理由不直接发顾客 | Auto |
| PAY-REF-10 | P0 | Live 环境 | 打开直接退款 | 明确 Live 与不可撤销；要求强确认（至少输入订单号）后才允许 | Assisted |
| PAY-REF-11 | P1 | Cancel/Escape/外点 | 修改分配后关闭再打开 | 无写入；草稿重置；焦点返回触发按钮 | Auto |
| PAY-REF-12 | P0 | 双击/刷新/网络重试 | 连续提交同一退款 | 同一幂等键只产生一笔 Stripe refund/DB row/通知 | Assisted |
| PAY-REF-13 | P0 | 两管理员并发 | 同一余额同时退款 | 只成功可用金额；另一个 409/恢复，不超额 | Assisted |
| PAY-REF-14 | P0 | 已有 Pending | 再退款；模拟 orphan/Stripe in-flight | 先对账；未决不叠加；orphan 重用同 row/idempotency key | Assisted |
| PAY-REF-15 | P1 | Stripe 未配置/失败/超时 | 发起退款 | 503/可诊断状态；不把失败标成功；超时重试不双退 | Assisted |
| PAY-REF-16 | P0 | 多次部分退款 | 连续退至全部，再尝试超额 | 累计不超过原款；状态 Paid→Partial→Refunded 单向 | Assisted |
| PAY-REF-17 | P0 | 多币种/平台费 | AUD 与非 AUD、含 application fee | 原币种退款；Stripe connected account 正确；按策略返还平台费 | Assisted |
| PAY-REF-18 | P1 | 审计与通知 | 成功/失败/部分/全额 | 操作者、来源、金额、分配、Stripe 引用一致；顾客措辞准确且不含内部 note | Assisted |

## 13. 顾客退款请求审查（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-REQ-01 | P1 | 默认打开 Requests | 查看 URL 与列表 | 默认只显示 Pending；明确可切 All/Processing/Reviewed 状态 | Auto |
| PAY-REQ-02 | P1 | 请求详情 | 核对订单、餐厅、顾客、请求金额、原款、已退、余额、历史次数、原因、项目 | 与 DB/顾客提交快照一致 | Auto |
| PAY-REQ-03 | P1 | 状态/搜索/日期/餐厅 | 组合筛选并分页 | 取交集；计数与当前范围一致 | Auto |
| PAY-REQ-04 | P0 | Test + Pending | Approve 全额 | 徽标为 Test；只退 min(requested, refundable)；请求变 Approved | Assisted |
| PAY-REQ-05 | P0 | Live + Pending | 输入错误/正确订单号 | 错误时按钮禁用；完全匹配才可提交 | Assisted |
| PAY-REQ-06 | P0 | 部分批准 | 输入小于请求且不超过余额的金额 | 精确退款；分配按比例/策略可解释；剩余请求处理语义明确 | Assisted |
| PAY-REQ-07 | P0 | 非法批准额 | 空、0、负数、三位小数、超请求、超余额 | 前后端拒绝且不 claim 请求 | Auto |
| PAY-REQ-08 | P1 | Unconfigured/环境未知 | 打开批准弹窗 | 明确禁用；不允许以“Checking”状态提交 | Auto |
| PAY-REQ-09 | P1 | Approval note | 空白、trim、1000/1001、HTML | 可选；超长 400；安全显示，仅内部审计 | Auto |
| PAY-REQ-10 | P1 | Keep pending/Escape | 修改金额与 note 后关闭 | 请求仍 Pending；无 refund；重开草稿正确重置 | Auto |
| PAY-REQ-11 | P0 | 双击批准 | 快速提交/刷新/重试 | 只 claim/退款一次；按钮全局防重复 | Assisted |
| PAY-REQ-12 | P0 | 两管理员并发批准 | 同时点击 | 只有一个 claim 成功；另一个 409 already reviewed | Assisted |
| PAY-REQ-13 | P0 | Approve 与 Reject 并发 | 两人做相反决定 | 只有一种终态；无“已拒绝但已退款”矛盾 | Assisted |
| PAY-REQ-14 | P1 | Processing stale | 构造新鲜与过期 claim | 新鲜不可抢；超过阈值且无 refundId 才可安全 reclaim | Auto |
| PAY-REQ-15 | P0 | Stripe 失败/异常 | 批准中失败 | claim 重置为 Pending 或准确终态；可重试且不双退 | Assisted |
| PAY-REQ-16 | P1 | Reject | 空 note、正常 note、1000/1001 | note 必填；边界正确；请求变 Rejected，无退款 | Auto |
| PAY-REQ-17 | P0 | 非 Pending 请求 | 对 Processing/Approved/Rejected/Cancelled 重复 approve/reject | 409；历史审核人、时间、note 不变 | Auto |
| PAY-REQ-18 | P1 | 顾客通知 | Approve/Reject 后读取专用测试邮件与 My Orders | 金额/状态/理由准确；拒绝理由可读；无内部 approval note | Assisted |
| PAY-REQ-19 | P1 | 审计 | Approve/Reject/失败/reclaim | 请求、付款、退款、订单事件和操作者可串联 | Auto |
| PAY-REQ-20 | P1 | UI 刷新 | 审核成功后观察列表/Orders/History | Pending 列表移除；相关标签数据与余额及时更新，无旧按钮 | Auto |

## 14. 退款历史（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-HIST-01 | P1 | 状态矩阵 | 筛 Pending/Succeeded/Failed | 行、徽标、汇总金额与状态一致 | Auto |
| PAY-HIST-02 | P1 | 搜索/日期/餐厅 | 组合筛选 | 结果与 summary 同范围；无跨租户 | Auto |
| PAY-HIST-03 | P0 | 项目分配 | 查看按项退款 | 名称快照、数量、金额合计等于该退款可归属部分 | Auto |
| PAY-HIST-04 | P1 | 一般调整 | 查看 unattributedAmount | 单独标识，不伪装为某商品退款 | Auto |
| PAY-HIST-05 | P1 | Failed/Pending | 查看 failureReason/时间 | 失败原因仅内部适度显示；Pending 不显示 RefundedAt | Auto |
| PAY-HIST-06 | P1 | 多次退款 | 对同付款排序与展开 Orders 详情 | 顺序稳定；refund count/refunded/refundable 聚合一致 | Auto |
| PAY-HIST-07 | P1 | 旧记录 | 缺 providerRefundId/items 的兼容数据 | 使用内部 ID/legacy allocation 安全降级，不崩溃 | Auto |
| PAY-HIST-08 | P0 | 数据范围 | Admin A/Platform filter 导出前后核对 | A 永远看不到 B；Platform 筛选不漏/不混 | Auto |

## 15. CSV 导出（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-EXP-01 | P1 | 三标签 | 分别导出 | 文件名/表头对应 orders/requests/history；UTF-8 BOM，可在 Excel 正确打开 | Auto |
| PAY-EXP-02 | P0 | 当前筛选 | 搜索、日期、餐厅、状态后导出 | 只含当前筛选全集，不只当前页、不含别店 | Auto |
| PAY-EXP-03 | P1 | CSV 注入 | 字段以 =,+,-,@,tab/newline/引号开头 | 正确转义，并防止表格公式注入 | Auto |
| PAY-EXP-04 | P1 | 金额/币种/时间 | 对比页面、DB 和 CSV | 金额精度与币种列明确；UTC/本地约定清楚 | Auto |
| PAY-EXP-05 | P1 | 大数据 >5000 行 | 导出超过 50×100 | 全量导出，或明确告知截断/上限；不得静默只导前 5000 | Auto |
| PAY-EXP-06 | P1 | API 中途失败 | 第 N 页失败 | 不下载不完整文件；显示短错误并可重试 | Auto |
| PAY-EXP-07 | P1 | 双击 | 导出中再次点击/切标签 | 按钮禁用；只下载一个与启动时视图一致的文件 | Auto |
| PAY-EXP-08 | P0 | 隐私 | 检查顾客资料、Stripe ID 与下载访问 | 只导业务必要字段；权限/审计/保留策略明确；不得生成公开 URL | Assisted |

## 16. Webhook、乱序、幂等与对账（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-WEB-01 | P0 | 无效签名/无 secret | POST webhook | 400/503；不写 EventLog、Payment 或 Order | Auto |
| PAY-WEB-02 | P0 | 同 event.id | 重放 completed/succeeded/refund/dispute 事件 | 每个事件只处理一次；不重复通知、审计或状态动作 | Assisted |
| PAY-WEB-03 | P0 | 事件乱序 | Paid 后发旧 Pending/Failed；Refunded 后发 Paid | 单向状态策略阻止回退 | Assisted |
| PAY-WEB-04 | P0 | 错 connected account | A 的事件引用 B payment metadata | 拒绝/忽略并记录安全日志；A/B 均不被串改 | Assisted |
| PAY-WEB-05 | P0 | Checkout succeeded/async succeeded | 发送事件并刷新 Admin Payments | Payment/Order Paid、时间、事件、自动接单和 UI 一致 | Assisted |
| PAY-WEB-06 | P0 | async failed/expired/cancelled | 发送相应事件 | 不标 Paid；失败/取消可诊断且允许安全重试 | Assisted |
| PAY-WEB-07 | P0 | refund.created→updated/succeeded | 正序与重复发送 | Pending→Succeeded 单向；金额/分配/请求同步 | Assisted |
| PAY-WEB-08 | P0 | refund.failed 后迟到 succeeded | 发送乱序事件 | 按 Stripe 权威规则恢复 Succeeded；不再重复退款 | Assisted |
| PAY-WEB-09 | P0 | charge.refunded | Stripe 外部退款 | DineFlow 对账出完整/部分退款，余额与状态正确 | Assisted |
| PAY-WEB-10 | P0 | dispute created/updated/closed | 发送全生命周期 | 页面状态、deadline、金额和关闭结果及时更新，不回退 | Assisted |
| PAY-WEB-11 | P1 | webhook 丢失 | 付款后不投递，运行手工/后台 reconcile | 最终一致；冷却与批量上限防止打爆 Stripe | Assisted |
| PAY-WEB-12 | P0 | DB/网络在 Stripe 成功后失败 | 模拟保存/响应丢失后重试 | 通过 idempotency/reconcile 找回同一结果，不创建第二笔资金动作 | Assisted |

## 17. 无障碍、响应式、性能与清理（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PAY-REC-01 | P1 | 320/390/768/桌面 | 三标签、筛选、表格、展开详情 | 无页面级横向溢出；表格有可发现的局部滚动 | Assisted |
| PAY-REC-02 | P0 | 小屏弹窗 | 打开直接退款、批准、拒绝 | 内容可滚动；环境、金额、确认和底部按钮始终可触达 | Assisted |
| PAY-REC-03 | P1 | 键盘 | 完成筛选、排序、展开、复制、打开/取消弹窗 | 焦点可见、顺序合理、无键盘陷阱 | Assisted |
| PAY-REC-04 | P1 | 屏幕阅读器 | 检查 H1、tabs、表格、状态、金额、弹窗 | 名称/状态/错误可读；颜色不是唯一信号 | Assisted |
| PAY-REC-05 | P1 | 弹窗焦点 | 打开、提交失败、关闭 | 初始焦点安全；错误后定位；关闭返回触发按钮 | Auto |
| PAY-REC-06 | P1 | 断网/恢复 | 加载、sync、receipt、refund 前后断网 | 不伪造成功；按钮恢复；用户能安全判断是否需对账 | Assisted |
| PAY-REC-07 | P0 | 不确定提交结果 | 退款请求超时后刷新/重开 | 先查询 Stripe/DB 状态再允许重试，避免双退 | Assisted |
| PAY-REC-08 | P1 | 大数据 | 10k+ payments/refunds/requests | 服务端分页；首屏与交互在目标时间内；无浏览器内全量排序 | Auto |
| PAY-REC-09 | P1 | 安全错误 | 模拟 EF/Stripe/邮件异常 | 页面只显示短信息和 correlation id；无堆栈/secret/完整响应 | Auto |
| PAY-REC-10 | P0 | 收尾 | 对照基线和 Stripe Test Dashboard | 一次性订单登记；无孤立 Pending/Processing；金额可对账；证据已脱敏 | Assisted |

## 18. 推荐执行顺序

1. `PAY-PRE-*` 和 `PAY-ROLE-*`：先确认 Sandbox 与租户边界。
2. 只读的 `PAY-PAGE-*`、`PAY-LIST-*`、`PAY-SUM-*`、`PAY-DETAIL-*`。
3. `PAY-EXP-*`、`PAY-REC-01/03/04/05/08/09`。
4. `PAY-CHECK-*` 与 `PAY-SETTLE-*`：每个场景使用独立订单。
5. `PAY-REQ-*` 和 `PAY-REF-*`：退款不可逆，最后执行。
6. `PAY-WEB-*` 与并发/故障恢复；完成后统一对账和 `PAY-REC-10` 清理。

## 19. 未来执行时的用户接力

本轮不接力、不执行。以后明确运行本包时，以下步骤可能需要用户：

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| Stripe Checkout/3DS | 在官方测试页面完成测试支付或 challenge | DineFlow/Stripe/订单/事件四方对账 |
| Live 安全检查 | 只观察 Live 徽标与强确认，不提交真实退款 | 验证破坏性按钮不可误触 |
| 收据/通知 | 打开专用测试邮箱并转述 DineFlow 邮件内容 | 核对金额、币种、措辞和去重 |
| Stripe Dashboard | 确认 connected account 中的 charge/refund/fee/dispute | 与 DineFlow 页面和 DB 对账 |
| 手机/读屏 | 在实体设备完成指定路径 | 补记布局、焦点和读屏结果 |

## 20. 完成标准

- 所有被选择的 `PAY-*` 必须记录为 PASS/FAIL/BLOCKED/NOT RUN；未发生真实观察不能标 PASS。
- **P0 任一失败即阻止支付页面专项通过**：越权/跨租户、Live 误操作、金额/币种错误、重复或超额退款、状态回退、错误 connected account、webhook 验签/幂等失败、敏感数据泄露。
- 每笔 Sandbox 资金动作在 DineFlow Payment/Refund、Order、Stripe connected account、事件日志和审计中一致。
- 退款/审批失败或超时后没有孤立且不可恢复的 Pending/Processing 记录。
- CSV、截图、日志和报告不包含 secret、完整 Token、完整顾客联系方式或无需保留的完整 Stripe 标识符。
- 本包通过不代表餐厅 onboarding、顾客完整结账、打印、备份、监控或整站 release/full 验收通过。
