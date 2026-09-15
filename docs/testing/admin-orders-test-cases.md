# DineFlow Admin Orders 专项测试用例

测试包名称：`admin-orders`  
稳定用例前缀：`ORD-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-orders`、某个 `ORD-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/admin/orders`：订单列表与筛选、汇总指标、订单详情与状态历史、状态流转、支付资格、柜台收款、退款（整单/按项/一般性调整）、超时升级与实时更新。

相邻测试包，不要在本包内重复覆盖：
- Dashboard 上的最近订单与指标卡 → [dashboard-test-cases.md](dashboard-test-cases.md)
- 顾客下单、结账与顾客侧取消 → [full-system-test-cases.md](full-system-test-cases.md)
- 餐厅营业状态与接单暂停 → [admin-restaurants-test-cases.md](admin-restaurants-test-cases.md)
- Staff 岗位队列、Kitchen 看板、SLA、音效与打印站 → [staff-orders-test-cases.md](staff-orders-test-cases.md)
- 前台取餐、柜台收款、找零、桌台 Session、整桌结算与收据 → [front-counter-test-cases.md](front-counter-test-cases.md)

## 1. 执行与安全规则

- **只在 Local/Test/Staging 执行写操作。** 本包会推进订单状态、记录柜台收款和**发起真实退款**，Production 默认只读。
- **退款只允许在 Stripe 测试模式下执行**，且只对本轮创建的测试订单。对真实订单退款不可撤销。
- 测试前记录并在结束时恢复：被操作订单的 `status`、`paymentStatus`、`paidAt`、已有退款记录与状态历史条数。**已发生的退款无法回滚**，所以退款用例一律用一次性订单。
- 状态流转会触发打印、音效、通知与实时推送；确认打印机指向测试队列，不要把测试小票打到真实厨房。
- 越权用例必须使用 A/B 两个真实餐厅的订单，并**直接调用 API 复核**。
- 报告不得包含完整订单访问 Token、Stripe PaymentIntent/Charge 全 ID、顾客完整邮箱或电话。
- 本文件只定义用例；增加或修改用例不会自动开始浏览器操作。

## 2. 状态机（用例预期以此为准）

`OrderStatusTransitions` 定义的可用动作与目标状态。**注意 Pending 有三条快捷路径**，不是只能 Accept：

| 当前状态 | 可用动作 | 结果状态 |
|---|---|---|
| Pending | Accept | Accepted |
| Pending | MarkReady | **Ready**（跳过 Accepted/Preparing） |
| Pending | Complete | **Completed**（一步到底） |
| Pending | Reject | Rejected |
| Pending | Cancel | Cancelled |
| Accepted | StartPreparing | Preparing |
| Accepted | Reject / Cancel | Rejected / Cancelled |
| Preparing | MarkReady | Ready |
| Preparing | Cancel | Cancelled |
| Ready | Complete | Completed |
| Ready | Cancel | Cancelled |
| Completed | **Reopen** | **Ready**（不是 Pending） |
| Cancelled / Rejected | **Reopen** | **Pending** |

两条横切规则：

- **需要支付资格**（`RequiresPaymentEligibility`）：`Accept`、`StartPreparing`、`MarkReady`、`Complete`。未满足支付条件时这些动作不出现在 `availableActions` 里，直接调用也应被拒。
- **需要理由**（`RequiresReason`）：`Reject`、`Cancel`、`Reopen`。

## 3. 端点与授权

控制器基线是 **StaffApi**（员工可看、可推进），**只有退款收紧到 AdminApi**：

| 端点 | 授权 | 备注 |
|---|---|---|
| `GET /api/admin/orders` | StaffApi | 列表；非平台主按餐厅收窄 |
| `GET /api/admin/orders/summary` | StaffApi | **收入按币种分组返回，无合计** |
| `POST /api/admin/orders/{id}/transitions` | StaffApi | 状态流转 |
| `POST /api/admin/orders/{id}/counter-payment` | StaffApi | 柜台收款 |
| **`POST /api/admin/orders/{id}/refund`** | **AdminApi** | 退款 |
| `GET /api/admin/orders/{id}/status-history` | StaffApi | 状态历史 |

未分配餐厅的非平台主账号，在收款与退款端点会得到 **403「Current user is not assigned to a restaurant.」**。

**列表参数**：`q`、`status`、`payment`、`type`、`restaurant`、`page`、`pageSize`（10/20/50/100，默认 20）、`sort`（createdAt/orderNumber/restaurantName/status/paymentStatus/totalAmount，默认 createdAt）、`direction`（asc/desc，默认 desc）。

## 4. 推荐夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| PlatformOwner | 唯一 | 跨餐厅视角、多币种汇总 |
| RestaurantOwner / Admin A/B | 分属餐厅 A/B | 越权与退款权限 |
| Staff A/B | 分属餐厅 A/B | **可流转不可退款** |
| 未分配餐厅的 Admin | 无 restaurantId | 403 文案 |
| 订单矩阵 | 七种状态各至少一单 | 状态机与筛选 |
| 支付矩阵 | Paid / Pending / Unpaid / Failed / Cancelled / Expired | 支付资格与筛选 |
| 类型矩阵 | 堂食（带桌号）/ 外带 | type 筛选与小票 |
| 多币种订单 | 至少两种币种且金额不同 | 汇总不得合并币种 |
| 大额与零头订单 | 含改价、含小费、含多 topping | 退款金额与分摊 |
| 一次性可退订单 | 每轮新建，Stripe 测试模式已支付 | 退款用例专用 |
| 超时订单 | 已支付且未接单 >5 / >10 / >20 分钟 | 等待升级与顾客自助取消 |
| 两个员工会话 | 同店两标签 | 并发流转 |
| 打印机 | 指向测试队列 | 流转副作用 |

## 5. 前置检查（6）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-PRE-01 | P1 | 项目目录 | 记录分支、提交、环境与服务地址 | 明确不是误用生产环境 | Auto |
| ORD-PRE-02 | P1 | 角色账号 | 解析各夹具的角色与 restaurantId | 归属明确 | Auto |
| ORD-PRE-03 | P1 | 数据库 | 导出订单矩阵的 id/状态/支付/金额/币种基线 | 后置可精确核对 | Auto |
| ORD-PRE-04 | P1 | Stripe | 确认测试模式且密钥非生产 | 退款不触及真实资金 | Auto |
| ORD-PRE-05 | P1 | 打印 | 确认打印目标是测试队列 | 不打到真实厨房 | Assisted |
| ORD-PRE-06 | P1 | 一次性订单 | 生成本轮退款/流转专用订单并登记 | 破坏性用例不碰夹具订单 | Auto |

## 6. 路由、角色与租户隔离（14）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-ROLE-01 | P1 | 未登录 | 打开、刷新、后退 `/admin/orders` | 跳转登录；不闪现订单号、金额或顾客信息 | Auto |
| ORD-ROLE-02 | P1 | Customer | 打开页面并调用列表 API | 页面拒绝；API 403 | Auto |
| ORD-ROLE-03 | P1 | Staff A | 打开页面 | 可见本店订单；**没有退款入口** | Auto |
| ORD-ROLE-04 | P0 | Staff A | 直接调用 `POST /{id}/refund` | **403**；退款是 AdminApi，前端隐藏不是唯一防线 | Auto |
| ORD-ROLE-05 | P0 | Admin A | 列表只应含餐厅 A | 不出现 B 的订单；分页总数也不含 B | Auto |
| ORD-ROLE-06 | P0 | Admin A + B 的订单 id | `GET /{B}/status-history`、`POST /{B}/transitions` | 403/404；**B 的订单状态不变** | Auto |
| ORD-ROLE-07 | P0 | Admin A + B 的订单 | `POST /{B}/refund`、`POST /{B}/counter-payment` | 403；不得对别人的订单动钱 | Auto |
| ORD-ROLE-08 | P0 | Admin A | 列表带 `restaurant={B}` 参数 | 忽略或 403；**不得因为参数就跨店返回** | Auto |
| ORD-ROLE-09 | P1 | 未分配餐厅的 Admin | 调用收款与退款 | 403「Current user is not assigned to a restaurant.」；页面显示可读错误而非全 0 | Auto |
| ORD-ROLE-10 | P1 | PlatformOwner | 打开列表 | 可见全部餐厅订单；每行标明所属餐厅 | Auto |
| ORD-ROLE-11 | P1 | 不存在/畸形订单 id | 对各端点传随机 GUID、空串、SQL 片段 | 404/400；无堆栈或 SQL | Auto |
| ORD-ROLE-12 | P1 | 同浏览器切账号 | Admin A → Staff A → PlatformOwner | 列表与可用操作按当前身份重算 | Auto |
| ORD-ROLE-13 | P1 | 操作中被降级 | 保留页面后执行退款 | 按当前权限拒绝；不依赖前端缓存的角色 | Assisted |
| ORD-ROLE-14 | P1 | 顾客订单 Token | 用顾客侧访问 Token 调管理端接口 | 拒绝；两套凭证不得互通 | Auto |

## 7. 列表、搜索、筛选、排序与分页（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-LIST-01 | P1 | 任意后台角色 | 首次打开 | Loading 后显示列表、总数与分页；唯一 H1 | Auto |
| ORD-LIST-02 | P1 | 接口失败 | 让列表返回 500 | 可读错误并可重试；**不显示 0 单的空列表假象** | Auto |
| ORD-LIST-03 | P1 | 搜索订单号 | 搜完整与部分订单号 | 命中正确；大小写不敏感 | Auto |
| ORD-LIST-04 | P1 | 搜取餐号 | 搜 `#12` 与 `12` | 两种写法都能命中 | Auto |
| ORD-LIST-05 | P1 | 搜顾客/桌号/菜品 | 分别搜顾客名、邮箱、桌号、菜品名 | 各自命中；结果与后端一致 | Auto |
| ORD-LIST-06 | P1 | 搜支付标识 | 搜 Stripe session/intent 片段 | 命中；**报告中不记录完整 ID** | Auto |
| ORD-LIST-07 | P1 | 搜索通配符 | 搜 `%` 与 `_` | **按字面匹配**，不返回全部订单 | Auto |
| ORD-LIST-08 | P1 | 搜索空结果 | 搜确定不存在的串 | 明确空状态，不是加载中或错误 | Auto |
| ORD-LIST-09 | P1 | 状态筛选 | 逐个选择七种状态 | 结果只含该状态；总数随之变化 | Auto |
| ORD-LIST-10 | P1 | 支付筛选 | 逐个选择各支付状态 | 同上 | Auto |
| ORD-LIST-11 | P1 | 类型筛选 | 堂食/外带 | 同上；堂食显示桌号，外带显示取餐号 | Auto |
| ORD-LIST-12 | P1 | 餐厅筛选 | 平台主切换餐厅 | 结果与所选餐厅一致 | Auto |
| ORD-LIST-13 | P1 | 组合筛选 | 搜索+状态+支付+类型+餐厅同时生效 | 后端按交集返回；**分页总数与筛选一致** | Auto |
| ORD-LIST-14 | P1 | 排序 | 六个排序键各升降序一次 | 后端排序且跨页一致；方向指示正确 | Auto |
| ORD-LIST-15 | P1 | 金额排序 | 按 totalAmount 排序且列表含多币种 | **不得跨币种比大小**，或明确说明排序按数值不按价值 | Auto |
| ORD-LIST-16 | P1 | 分页 | pageSize 10/20/50/100 与翻页 | 每页条数正确；`x–y of z` 与实际一致 | Auto |
| ORD-LIST-17 | P1 | 页码越界 | 手工把 page 改到远超总页数 | 自动钳制并同步 URL | Auto |
| ORD-LIST-18 | P1 | 深链与后退 | 带全部参数的 URL、刷新、连续后退 | 状态完整还原；每步可回退 | Auto |
| ORD-LIST-19 | P2 | 非法参数 | `page=0`、`pageSize=999`、未知 sort | 回落到合法默认值，不报错 | Auto |
| ORD-LIST-20 | P1 | 数据变更后分页 | 别人推进了当前页的订单后翻页 | 无重复或漏项；或明确提示需刷新 | Assisted |

## 8. 汇总指标（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-SUM-01 | P1 | API 快照 | 对比 total/activeKitchen/paid/pendingPayment/failedPayment/payable | UI 数字与同权限范围的 API/DB 一致 | Auto |
| ORD-SUM-02 | P0 | 多币种 | 平台主查看收入 | **按币种分别显示，不得合并成一个数**，也不得用任一餐厅的币种标注合计 | Auto |
| ORD-SUM-03 | P1 | 单币种 | 仅一种币种时 | 显示为单一金额，读起来自然 | Auto |
| ORD-SUM-04 | P1 | 无已付订单 | 筛到没有 Paid 的范围 | 明确"无已付订单"，不是某币种的 0.00 | Auto |
| ORD-SUM-05 | P1 | 汇总随筛选 | 施加筛选后看汇总 | 汇总覆盖筛选后的完整范围，**不是当前页的合计** | Auto |
| ORD-SUM-06 | P1 | 加载失败 | 让汇总接口失败 | 指标显示不可用状态，**不是 0** | Auto |
| ORD-SUM-07 | P1 | payable 定义 | 构造各支付状态订单 | 只统计线上支付且未成功、且订单未取消/拒绝的 | Auto |
| ORD-SUM-08 | P1 | 权限范围 | Staff/Admin/平台主分别查看 | 各自范围内一致；Staff 不得看到全平台数字 | Auto |

## 9. 订单详情与状态历史（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-DET-01 | P1 | 任意订单 | 打开详情 | 显示订单号、状态、支付、金额、类型、桌号/取餐号、明细 | Auto |
| ORD-DET-02 | P1 | 含 topping 的行 | 检查明细金额 | **显示单品原价、加料与行合计**，不是只有加完的总价 | Auto |
| ORD-DET-03 | P1 | 币种 | 多币种订单 | 每单用自己的币种格式化 | Auto |
| ORD-DET-04 | P1 | 状态历史 | 打开历史 | 按时间顺序列出每次变更、操作者与理由 | Auto |
| ORD-DET-05 | P1 | 理由留存 | Reject/Cancel/Reopen 后查历史 | 理由完整保留且与提交内容一致 | Auto |
| ORD-DET-06 | P1 | 历史不可篡改 | 尝试重复流转 | 历史只追加，不覆盖 | Auto |
| ORD-DET-07 | P1 | 顾客信息 | 检查展示 | 只展示履约必要信息；**报告中打码** | Auto |
| ORD-DET-08 | P1 | 已退款订单 | 打开详情 | 清楚显示已退金额、退款项与剩余可退 | Auto |
| ORD-DET-09 | P1 | 空历史 | 刚创建未流转的订单 | 显示创建记录，不是空白或报错 | Auto |
| ORD-DET-10 | P2 | 长明细 | 30+ 行的订单 | 布局不溢出；打印与页面一致 | Assisted |

## 10. 状态流转（22）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-FLOW-01 | P1 | Pending | Accept | → Accepted；历史记录操作者 | Auto |
| ORD-FLOW-02 | P1 | Pending | **MarkReady（快捷）** | → **Ready**，跳过中间状态 | Auto |
| ORD-FLOW-03 | P1 | Pending | **Complete（快捷）** | → **Completed** | Auto |
| ORD-FLOW-04 | P1 | Pending | Reject（带理由） | → Rejected | Auto |
| ORD-FLOW-05 | P1 | Pending | Cancel（带理由） | → Cancelled | Auto |
| ORD-FLOW-06 | P1 | Accepted | StartPreparing | → Preparing | Auto |
| ORD-FLOW-07 | P1 | Accepted | Reject / Cancel | → Rejected / Cancelled | Auto |
| ORD-FLOW-08 | P1 | Preparing | MarkReady | → Ready | Auto |
| ORD-FLOW-09 | P1 | Preparing | **Reject 不可用** | 动作不在列表；直接调用被拒 | Auto |
| ORD-FLOW-10 | P1 | Ready | Complete | → Completed | Auto |
| ORD-FLOW-11 | P1 | Completed | **Reopen** | → **Ready**（不是 Pending） | Auto |
| ORD-FLOW-12 | P1 | Cancelled | **Reopen** | → **Pending** | Auto |
| ORD-FLOW-13 | P1 | Rejected | **Reopen** | → **Pending** | Auto |
| ORD-FLOW-14 | P0 | 任意 | 直接调用当前状态不允许的动作 | **拒绝且状态不变**；`availableActions` 不是唯一防线 | Auto |
| ORD-FLOW-15 | P1 | 需要理由的动作 | Reject/Cancel/Reopen 不带理由 | 拒绝并提示；带理由则成功 | Auto |
| ORD-FLOW-16 | P1 | 理由长度 | 超长理由 | 有上限且提示明确 | Auto |
| ORD-FLOW-17 | P1 | 可用动作一致性 | 对每种状态核对返回的 availableActions | 与第 2 节表格逐格一致 | Auto |
| ORD-FLOW-18 | P1 | 副作用 | 流转后检查打印/音效/实时推送 | 该触发的触发，不该触发的不触发 | Assisted |
| ORD-FLOW-19 | P1 | 防重入 | 快速连点同一动作 | 只流转一次；历史只加一条 | Auto |
| ORD-FLOW-20 | P0 | 并发流转 | 两名员工同时 Accept 同一单 | **一个成功一个被明确拒绝**；不产生两条 Accepted 记录 | Assisted |
| ORD-FLOW-21 | P1 | 中断 | 流转请求发出后刷新/断网 | 以服务器为准；无假成功或重复写入 | Auto |
| ORD-FLOW-22 | P1 | 审计 | 逐个动作核对审计 | 成功有记录、失败无成功记录；含前后状态 | Auto |

## 11. 支付资格与柜台收款（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-PAY-01 | P0 | 线上未付订单 | 查看可用动作 | **Accept/StartPreparing/MarkReady/Complete 都不可用**；Reject/Cancel 仍可用 | Auto |
| ORD-PAY-02 | P0 | 线上未付订单 | 直接调用 Accept | 拒绝；不得靠前端隐藏 | Auto |
| ORD-PAY-03 | P1 | 已付订单 | 查看可用动作 | 四个推进动作可用 | Auto |
| ORD-PAY-04 | P1 | 柜台支付订单 | 查看可用动作 | 按策略可推进；与线上未付区分清楚 | Auto |
| ORD-PAY-05 | P1 | 柜台收款 | 记录一次柜台收款 | paymentStatus 变为已付；paidAt 有值 | Auto |
| ORD-PAY-06 | P1 | 重复收款 | 对已付订单再次收款 | 拒绝或幂等；**不产生两笔收入** | Auto |
| ORD-PAY-07 | P0 | 收款后推进 | 收款后再 Accept | 可推进；顺序正确 | Auto |
| ORD-PAY-08 | P1 | 未分配餐厅 | 未分配 Admin 调收款 | 403 且文案明确 | Auto |
| ORD-PAY-09 | P0 | 跨店收款 | Admin A 对 B 的订单收款 | 403；不得动别人的钱 | Auto |
| ORD-PAY-10 | P1 | 已取消订单 | 对已取消订单收款 | 拒绝并说明 | Auto |
| ORD-PAY-11 | P1 | 金额一致性 | 收款后对比订单金额与支付记录 | 完全一致；币种正确 | Auto |
| ORD-PAY-12 | P1 | 审计 | 核对收款审计 | 记录操作者、订单、金额与币种 | Auto |

## 12. 退款（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-REF-01 | P0 | Staff | 调用退款端点 | **403**（AdminApi） | Auto |
| ORD-REF-02 | P0 | Admin + 别店订单 | 调用退款 | 403 | Auto |
| ORD-REF-03 | P1 | 未付订单 | 发起退款 | 拒绝并说明无可退金额 | Auto |
| ORD-REF-04 | P1 | 整单退款 | 不指定金额与项 | 全额退回；订单标记已退 | Assisted |
| ORD-REF-05 | P1 | 按项退款 | 指定部分 orderItemId | 只退这些项；剩余可退金额正确 | Assisted |
| ORD-REF-06 | P0 | 重复项 | 同一 orderItemId 传两次 | **拒绝**；不得按两倍退 | Auto |
| ORD-REF-07 | P1 | 一般性调整 | 只给 generalAdjustmentAmountCents | 按该金额退；记录为调整而非退项 | Assisted |
| ORD-REF-08 | P0 | 金额覆盖非法 | amountCents 传 0 与负数 | **拒绝**「Refund amount must be greater than zero.」 | Auto |
| ORD-REF-09 | P0 | 超额退款 | 退款额大于可退余额 | 拒绝；**任何路径都不得退超原始收款** | Auto |
| ORD-REF-10 | P0 | 累计超额 | 连续多次部分退款直到超出 | 最后一次被拒；累计不超过原额 | Assisted |
| ORD-REF-11 | P1 | 理由长度 | 理由 1001 字符 | 拒绝「Reason cannot exceed 1000 characters.」 | Auto |
| ORD-REF-12 | P1 | 理由留存 | 正常退款带理由 | 理由进入退款记录与审计；**内部理由不得直接转发给顾客** | Auto |
| ORD-REF-13 | P1 | 顾客通知 | 退款成功后 | 顾客收到退款邮件，金额与币种正确 | Assisted |
| ORD-REF-14 | P1 | 部分退款措辞 | 部分退款后看邮件 | **明说是部分退款并给出原单金额** | Assisted |
| ORD-REF-15 | P1 | 退款失败 | 让 Stripe 返回失败 | 订单不标记为已退；顾客收到"未成功"通知；可重试 | Assisted |
| ORD-REF-16 | P1 | 幂等 | 快速重复提交同一退款 | 只产生一笔；不重复扣款 | Auto |
| ORD-REF-17 | P1 | Stripe 未配置 | 清空密钥后退款 | 503 且文案明确，不是 500 | Auto |
| ORD-REF-18 | P1 | 退款后状态 | 退款后检查订单可用动作 | 与业务规则一致；不出现自相矛盾的入口 | Auto |
| ORD-REF-19 | P1 | 币种 | 非 AUD 订单退款 | 退款币种与原单一致；金额不被换算 | Assisted |
| ORD-REF-20 | P1 | 审计与对账 | 核对退款审计与支付记录 | 金额、币种、操作者、Stripe 引用一致；**报告中 ID 打码** | Auto |

## 13. 等待升级与超时处理（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-SLA-01 | P1 | 已付未接单 <5 分钟 | 查看列表 | 显示等待时长，无升级样式 | Auto |
| ORD-SLA-02 | P1 | 已付未接单 >5 分钟 | 查看列表 | 进入警示态；文案说明已等待多久 | Auto |
| ORD-SLA-03 | P1 | 已付未接单 >10 分钟 | 查看列表 | 进入超时态；**音效与新单音效可区分** | Assisted |
| ORD-SLA-04 | P1 | 超时音效开关 | 关闭超时提醒 | 只影响超时音效，不影响新单音效 | Assisted |
| ORD-SLA-05 | P1 | 已付未接单 >20 分钟 | 顾客侧查看 | 顾客可自助取消并退款 | Assisted |
| ORD-SLA-06 | P1 | 顾客自助取消 | 顾客取消后管理端刷新 | 状态与退款同步可见 | Assisted |
| ORD-SLA-07 | P1 | 餐厅打烊未接单 | 打烊后等待宽限期 | 自动退款并通知顾客，理由可读 | Assisted |
| ORD-SLA-08 | P1 | 自动退款幂等 | 同一单被扫描多次 | 只退一次；幂等键生效 | Auto |
| ORD-SLA-09 | P1 | 平台可见性 | 已付未接单堆积 | 平台侧可见该情况，不只依赖餐厅自查 | Auto |
| ORD-SLA-10 | P1 | 时间显示 | 检查等待时长文案 | 按餐厅时区与真实创建时间计算 | Auto |

## 14. 实时更新与并发（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-RT-01 | P1 | 两个标签 | 一个标签流转，另一个观察 | 另一个及时更新，或明确提示需刷新 | Assisted |
| ORD-RT-02 | P1 | 新订单进入 | 顾客下单 | 列表出现新单并触发新单提示 | Assisted |
| ORD-RT-03 | P1 | 连接断开 | 断开实时通道 | 明确降级提示；恢复后自动补齐 | Assisted |
| ORD-RT-04 | P0 | 并发流转 | 见 ORD-FLOW-20 | 一成功一被拒 | Assisted |
| ORD-RT-05 | P0 | 并发退款 | 两名管理员同时对同一单退款 | **只成功一笔**；不重复退款 | Assisted |
| ORD-RT-06 | P1 | 流转与退款交叉 | 一人取消同时另一人退款 | 结果自洽；不出现"已取消但未退款"且无记录 | Assisted |
| ORD-RT-07 | P1 | 列表陈旧 | 在旧列表上操作已变更的订单 | 明确冲突提示；可刷新到正确状态 | Assisted |
| ORD-RT-08 | P1 | 打印重复 | 同一单被两处推进 | 不重复打印或明确标注补打 | Assisted |

## 15. 恢复、无障碍与响应式（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| ORD-REC-01 | P1 | API 401/403/429/500/503 | 覆盖各操作的错误呈现 | 短消息可重试；**不显示 SQL、堆栈、Stripe 密钥或内部地址** | Auto |
| ORD-REC-02 | P1 | 会话过期 | 停留后执行流转或退款 | 引导重新登录；不误报成功 | Assisted |
| ORD-REC-03 | P1 | 页面语义 | 检查 H1、表格、筛选、Dialog | 唯一 H1；表头与单元格关联；筛选有名称 | Auto/Assisted |
| ORD-REC-04 | P1 | 控件命名 | 检查状态按钮与退款入口 | 每个动作有可读名称，**不只靠图标或颜色** | Auto |
| ORD-REC-05 | P1 | 状态传达 | 检查状态与支付徽章 | 不只靠颜色区分；有文字 | Auto |
| ORD-REC-06 | P1 | 纯键盘 | 完成筛选→打开详情→流转→退款 | 焦点顺序合理可见、无陷阱；Dialog 关闭返回触发器 | Assisted |
| ORD-REC-07 | P2 | 屏幕阅读器 | 读取订单行、状态变化、超时提醒 | 状态成组可读；动态变化通过合适 live region 宣告 | Assisted |
| ORD-REC-08 | P1 | 390/430px 手机 | 浏览列表、详情、退款对话框 | 无横向溢出；金额与按钮不被遮挡 | Assisted |
| ORD-REC-09 | P1 | 平板/200% zoom | 重复关键操作 | 表格降级可用；Dialog 可滚动可关闭 | Assisted |
| ORD-REC-10 | P1 | 前端自动化 | 运行 admin orders 相关单测 | 状态机、筛选、退款金额、超时有稳定断言 | Auto |
| ORD-REC-11 | P1 | 后端自动化 | 运行 orders 权限、状态机、退款测试 | 关键权限/状态/金额测试通过且无关键 skip | Auto |
| ORD-REC-12 | P1 | 测试结束 | 核对数据库与证据 | 夹具订单状态恢复；一次性订单登记在案；截图无 Token 或完整支付 ID | Auto |

## 16. 推荐执行顺序

1. `ORD-PRE-*`，确认身份、基线、Stripe 测试模式与打印目标。
2. `ORD-ROLE-*`，先把退款权限和跨租户边界钉死。
3. 只读的 `ORD-LIST-*`、`ORD-SUM-*`、`ORD-DET-*`。
4. `ORD-FLOW-*`，用一次性订单逐状态推进，每组结束核对历史。
5. `ORD-PAY-*`，收款后再验推进顺序。
6. **`ORD-REF-*` 最后做且只用一次性订单**——退款不可逆。
7. `ORD-SLA-*`、`ORD-RT-*`，需要等待与多会话。
8. 无障碍、响应式与最终清理。

## 17. 用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| 下单 | 在测试餐厅用测试卡下一单并完成支付 | 订单进入列表，支付状态与金额正确 |
| 退款到账 | 查看 Stripe 测试面板的退款记录 | 金额、币种与订单一致 |
| 退款邮件 | 打开测试收件箱转述退款邮件 | 部分/全额措辞正确，含原单金额 |
| 超时音效 | 让一单等待超过 10 分钟并听提示音 | 与新单音效可区分；开关只影响该音效 |
| 打印 | 观察测试打印队列 | 流转触发的小票内容与页面一致 |
| 触屏 | 在手机上完成一次状态流转 | 按钮可点、确认对话框不被遮挡 |

## 18. 完成标准

- 所有被选 `ORD-*` 都记录为 PASS/FAIL/BLOCKED/NOT RUN；部分观察不能冒充 PASS。
- **P0 任一失败即阻止上线结论**：Staff 能退款、跨租户读写或退款、未付订单被推进、非法状态流转成功、重复退款或超额退款、并发流转产生两条记录、多币种收入被合并。
- 每笔退款在订单、支付记录、Stripe 测试面板与审计四处一致。
- 所有一次性订单登记在案；**已发生的退款不可回滚，报告须如实记录**。
- 报告不含完整订单 Token、完整 Stripe ID、顾客完整联系方式。
- 本包通过不代表顾客下单、支付、打印或完整 release/full 验收通过。
