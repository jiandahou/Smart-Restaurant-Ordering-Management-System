# DineFlow Staff Orders 专项测试用例

测试包名称：`staff-orders`  
稳定用例前缀：`STAFF-*`  
目标页面：`/staff/orders`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `staff-orders`、指定 `STAFF-*`，或明确要求 `full` 时才执行。

本测试包以当前实现为准，覆盖 Staff Orders 的订单队列、Orders/Kitchen 双视图、搜索排序、优先级分类、状态流转、柜台收款、退款请求提示、等待 SLA、音效、轮询与实时更新、打印站与打印恢复、无障碍和响应式。

相邻测试包不要重复执行：

- `/admin/orders` 的后台汇总、完整状态历史和管理员退款 → [admin-orders-test-cases.md](admin-orders-test-cases.md)
- 顾客购物车、结账、订单创建与 Token 隔离 → [cart-test-cases.md](cart-test-cases.md)
- 支付、Stripe webhook、退款资金对账 → [admin-payments-test-cases.md](admin-payments-test-cases.md)
- Dashboard 的接单开关、营业时间和平台汇总 → [dashboard-test-cases.md](dashboard-test-cases.md)

## 1. 执行与安全规则

- 写操作只允许在 Local/Test/Staging；Production 默认只读。
- 状态流转、柜台收款、退款审批、自动接单和打印会产生不可忽略的业务副作用，必须使用本轮专用订单。
- 打印连接检测不等于真实出票。实体打印、切纸、蜂鸣、断纸和队列恢复必须由用户观察后才能 PASS。
- 不得清理 OS/QZ 打印队列，除非用户明确授权本次清理的打印机与范围。
- 测试前记录订单、支付、打印任务、自动接单、打印站租约和音效设置；结束后恢复可逆配置。
- 报告不得包含完整订单访问 Token、完整 Stripe 标识、顾客完整邮箱/电话、QZ 签名或证书私钥。
- `Staff`、`Admin`、`RestaurantOwner` 与 `PlatformOwner` 必须使用分开的账号；切换账号后重新加载页面。

## 2. 当前功能基线

### 2.1 视图与队列

| 区域 | 当前行为 |
|---|---|
| Orders | 卡片式订单工作队列，支持搜索、排序和 8 个队列标签 |
| Kitchen | New / Preparing / Ready 三列厨房看板；移动端用三标签切换 |
| Active | 非支付阻断、非 carried-over 的未关闭订单 |
| New | `Pending` |
| Kitchen | `Accepted`、`Preparing` |
| Ready | `Ready` |
| Over 20 min | 未关闭、非支付阻断、非 carried-over，且等待至少 20 分钟 |
| Payment holds | 在线支付 Pending/Unpaid/Failed/Cancelled/Expired，或已全额退款 |
| Carried over | 未关闭且创建超过 24 小时 |
| Closed | `Completed`、`Cancelled`、`Rejected` |

### 2.2 Staff 渐进式主动作

| 当前状态 | Staff 主动作 | 目标状态 |
|---|---|---|
| Pending | Accept | Accepted |
| Accepted | Start cooking | Preparing |
| Preparing | Mark ready | Ready |
| Ready | Complete | Completed |

Staff 页面不暴露 Admin Orders 的 Pending→Ready、Pending→Completed 快捷路径。破坏性动作是 Pending→Reject，以及 Accepted/Preparing/Ready→Cancel，均要求填写理由。

### 2.3 支付资格

- `Paid`、`PartiallyRefunded`、`NotRequired`：允许厨房处理。
- `PayAtCounter + Unpaid`：允许厨房处理，并显示 `Mark paid`。
- 在线 `Pending/Unpaid`：进入 Payment holds，暂停厨房处理。
- 在线 `Failed/Cancelled/Expired`：进入 Payment holds，暂停厨房处理。
- `Refunded`：暂停履约；Pending 应 Reject，其他未关闭状态应 Cancel。

### 2.4 数据刷新

- 搜索输入 300ms debounce。
- 页面每 15 秒轮询一次。
- SignalR 订单事件触发补充刷新。
- Staff API 最多取前 100 条；超过时页面必须明确提示当前只显示前 N 条。

## 3. 推荐测试夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| Staff A / Staff B | 分属两个餐厅 | 租户隔离 |
| 同店 Staff A1 / A2 | 两个浏览器会话 | 实时与并发 |
| Admin / Owner A | 餐厅 A | 退款请求审批和角色差异 |
| PlatformOwner | 可见多店 | 餐厅筛选与打印站选店 |
| Customer | 普通顾客 | 路由拒绝 |
| 订单状态矩阵 | Pending/Accepted/Preparing/Ready/Completed/Cancelled/Rejected | 队列与动作 |
| 支付矩阵 | Paid/PartiallyRefunded/NotRequired/Pending/Unpaid/Failed/Cancelled/Expired/Refunded | 支付阻断 |
| 订单类型 | DineIn、Takeaway、计划单 | 桌号、取餐号和时间 |
| 菜品矩阵 | 选项、数量、普通备注、过敏安全备注、部分/全部退款行 | 厨房内容 |
| SLA 订单 | <5、5–10、10–20、≥20 分钟及 >24 小时 | 提醒与队列 |
| QZ 测试终端 | QZ Tray、测试打印机、纸张 | 打印连接与实体票 |
| 两个打印标签页 | 同一餐厅 | 打印站租约与防重复 |

## 4. 前置检查（8）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-PRE-01 | P1 | 项目目录 | 记录环境、分支、提交、dirty 数量、前后端地址 | 明确不是误用 Production | Auto |
| STAFF-PRE-02 | P1 | 角色账号 | 核对每个账号的 role、userId、restaurantId | 身份和租户范围明确 | Auto |
| STAFF-PRE-03 | P1 | 订单矩阵 | 导出状态、支付、金额、创建时间、更新时间基线 | 流转后可精确核对 | Auto |
| STAFF-PRE-04 | P1 | 两店数据 | 确认 A/B 各有唯一可识别订单 | 越权检查不会误判同名数据 | Auto |
| STAFF-PRE-05 | P1 | 实时环境 | 记录 SignalR 地址与连接状态 | 实时用例有基线 | Auto |
| STAFF-PRE-06 | P1 | 打印 | 确认 QZ/浏览器模式、目标打印机、打印站 key、是否测试队列 | 不误打真实厨房 | Assisted |
| STAFF-PRE-07 | P1 | 音频 | 确认浏览器已获得用户手势并允许播放声音 | 音效失败不被误判为业务失败 | Assisted |
| STAFF-PRE-08 | P1 | 一次性订单 | 为流转、收款、退款请求与打印各登记专用订单 | 不修改长期夹具或真实订单 | Auto |

## 5. 路由、角色与租户隔离（13）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-ROLE-01 | P1 | 未登录 | 打开、刷新、后退 `/staff/orders` | 跳转登录；不闪现订单号、金额或顾客资料 | Auto |
| STAFF-ROLE-02 | P1 | Customer | 直接打开页面 | Access denied/安全跳转；无订单数据闪现 | Auto |
| STAFF-ROLE-03 | P0 | Customer Token | 直接调用 `/api/staff/orders` | 403；顾客 Token 不可作为 Staff 凭证 | Auto |
| STAFF-ROLE-04 | P1 | Staff A | 打开页面 | 仅显示餐厅 A；无餐厅选择器 | Auto |
| STAFF-ROLE-05 | P0 | Staff A | 搜索餐厅 B 的完整订单号、取餐号、桌号和菜品 | 0 结果；不得泄露 B 是否存在 | Auto |
| STAFF-ROLE-06 | P0 | Staff A + B 订单 id | 直接调用状态流转、柜台收款、重打 | 403/404；B 订单和打印任务均不变 | Auto |
| STAFF-ROLE-07 | P1 | 未分配餐厅的 Staff | 打开页面并调用列表 | 403 `Current user is not assigned to a restaurant.`；页面不伪装为空队列 | Auto |
| STAFF-ROLE-08 | P1 | Admin/Owner A | 打开 Staff Orders | 可执行餐厅 A 的岗位功能；范围仍只限 A | Auto |
| STAFF-ROLE-09 | P1 | PlatformOwner | 未指定打印餐厅时打开页面 | 可看平台订单；自动打印暂停并要求选择打印餐厅 | Auto |
| STAFF-ROLE-10 | P0 | PlatformOwner | 选择餐厅 A 后观察列表和打印站 | 列表筛选与打印餐厅作用域清楚；不得把 A 票路由到 B | Assisted |
| STAFF-ROLE-11 | P1 | 同浏览器切账号 | Staff A→Staff B→Customer | 页面、搜索、队列、租约和可用动作按新身份重置 | Auto |
| STAFF-ROLE-12 | P1 | 账号被禁用/降级 | 保留旧页面后刷新并尝试动作 | 按当前权限拒绝；不依赖旧页面缓存 | Assisted |
| STAFF-ROLE-13 | P0 | PlatformOwner 已将打印站分配给餐厅 A | 仅用列表 Restaurant 筛选切到餐厅 B，再打开打印设置 | 浏览列表是只读操作；不得静默把 Print restaurant/自动打印/租约从 A 改成 B | Auto |

## 6. 页面加载、刷新与错误状态（11）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-PAGE-01 | P1 | 正常环境 | 首次打开 | 唯一 H1 `Staff Orders`；显示餐厅和队列作用域 | Auto |
| STAFF-PAGE-02 | P1 | 首次加载 | 观察加载状态 | 显示 `Loading restaurant orders...`；不先闪空状态 | Auto |
| STAFF-PAGE-03 | P1 | 手动刷新 | 点击 Refresh | 按钮禁用/旋转；完成后更新时间和数据更新 | Auto |
| STAFF-PAGE-04 | P1 | 快速双击 Refresh | 连点两次 | 不产生并发覆盖或重复成功提示 | Auto |
| STAFF-PAGE-05 | P1 | 列表 500 | 初始加载与手动刷新各失败一次 | 保留可读错误；旧数据策略明确；无堆栈/内部地址 | Auto |
| STAFF-PAGE-06 | P1 | 401/403 | 页面加载期间会话过期或失权 | 引导重新登录/拒绝访问；不显示旧租户数据 | Auto |
| STAFF-PAGE-07 | P1 | 429 | 连续刷新触发限流 | 显示短提示和可重试时机；页面不崩溃 | Auto |
| STAFF-PAGE-08 | P1 | 慢请求 | 搜索/切店/刷新请求乱序返回 | 最终显示最新选择对应结果，旧响应不覆盖 | Auto |
| STAFF-PAGE-09 | P1 | 浏览器刷新 | QZ 正常运行时刷新页面 | 不闪出虚假 QZ/打印机离线；连接后自动复核 | Assisted |
| STAFF-PAGE-10 | P1 | 页面恢复焦点 | 后台放置后回到页面 | 数据、QZ、打印机状态及时重检；无陈旧成功状态 | Assisted |
| STAFF-PAGE-11 | P1 | 已选择餐厅、队列、搜索、排序与 Kitchen 视图 | 浏览器刷新、后退再前进 | 持久配置（打印餐厅）按设计保留；临时列表状态按一致策略恢复或重置，不出现筛选文案与实际请求不一致 | Auto |

## 7. 搜索、排序与结果上限（17）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-LIST-01 | P1 | 默认 | 打开页面 | 默认 `Newest first`；卡片顺序与 API 一致 | Auto |
| STAFF-LIST-02 | P1 | 搜订单号 | 输入完整与部分订单号 | 300ms 后请求；命中正确订单 | Auto |
| STAFF-LIST-03 | P1 | 搜取餐号 | 搜 `#008`、`008`、`8` | 按产品格式正确命中，不混入无关单 | Auto |
| STAFF-LIST-04 | P1 | 搜桌号 | 搜本店桌号 | 仅返回相应堂食单 | Auto |
| STAFF-LIST-05 | P1 | 搜菜品名 | 搜主菜与选项名称 | 主菜按契约命中；未支持的选项搜索不伪装成功 | Auto |
| STAFF-LIST-06 | P1 | 特殊字符 | 搜 `%`、`_`、单引号、emoji、前后空格 | 字面匹配/安全空结果；无 SQL 或 500 | Auto |
| STAFF-LIST-07 | P1 | 快速输入 | 连续输入 10 个字符 | debounce 后只以最终值查询；无请求风暴 | Auto |
| STAFF-LIST-08 | P1 | 清除搜索 | 点击清除按钮 | 输入、loading 和结果恢复；焦点合理 | Auto |
| STAFF-LIST-09 | P1 | 搜索+队列 | 搜索后切 New/Kitchen/Ready | 搜索条件保留，结果为交集 | Auto |
| STAFF-LIST-10 | P1 | 排序矩阵 | Oldest/Newest/Recently updated/Amount high/low/Order number | 顺序稳定；同值用 id 保持确定性 | Auto |
| STAFF-LIST-11 | P1 | Kitchen 视图 | 切换 Kitchen priority | 看板按厨房优先级排序，不错误继承金额排序 | Auto |
| STAFF-LIST-12 | P1 | >100 条 | 构造 101+ 匹配订单 | 明示 `Showing the first 100 of N`，不声称已显示全部 | Auto |
| STAFF-LIST-13 | P1 | 空结果 | 搜不存在内容 | 显示带搜索词的空状态；不是错误或 loading | Auto |
| STAFF-LIST-14 | P1 | 无搜索空队列 | 切到确实为空的队列 | 显示 `No orders in this queue.` | Auto |
| STAFF-LIST-15 | P0 | 订单有可识别顾客姓名 | 按完整姓名、部分姓名和不同大小写搜索 | 与占位文案 `customer` 一致命中该顾客订单；不得必须改搜订单号 | Auto |
| STAFF-LIST-16 | P1 | 同一订单可由多字段命中 | 分别用订单号/菜名的不同大小写、首尾空格搜索 | 搜索大小写不敏感且 trim 一致；结果、总数与清除后的恢复正确 | Auto |
| STAFF-LIST-17 | P1 | PlatformOwner All restaurants 下两店存在相同取餐号/桌号 | 搜该号码并查看全部结果 | 两店结果都可出现且餐厅标签清楚；切单店后只剩目标店，不能把号码当全局唯一 | Auto |

## 8. 队列分类与优先级汇总（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-QUEUE-01 | P1 | Pending 已付 | 检查 Active/New | 同时计入 Active 和 New | Auto |
| STAFF-QUEUE-02 | P1 | Accepted/Preparing | 检查 Active/Kitchen | 同时计入；不进入 New/Ready | Auto |
| STAFF-QUEUE-03 | P1 | Ready | 检查 Active/Ready | 同时计入；优先级条 Ready 数一致 | Auto |
| STAFF-QUEUE-04 | P1 | Completed/Cancelled/Rejected | 检查 Closed | 仅进入 Closed，不进入 Active | Auto |
| STAFF-QUEUE-05 | P0 | 在线 Pending/Unpaid | 检查 Payment holds | 进入 Payment holds；不进入 Active/New/Kitchen/Ready | Auto |
| STAFF-QUEUE-06 | P0 | 在线 Failed/Cancelled/Expired | 检查 Payment holds | 进入并显示支付失败说明；不可厨房处理 | Auto |
| STAFF-QUEUE-07 | P0 | Refunded | 检查 Payment holds | 进入支付阻断；提示 Reject/Cancel 后再履约 | Auto |
| STAFF-QUEUE-08 | P1 | PayAtCounter Unpaid | 检查 Active 与相应状态队列 | 不算支付阻断；显示 Counter payment due | Auto |
| STAFF-QUEUE-09 | P1 | 20 分钟边界 | 设置 19:59、20:00、20:01 | 只在达到阈值后进入 Over 20 min | Auto |
| STAFF-QUEUE-10 | P1 | >24h 未关闭 | 检查 Carried over | 进入 Carried over，不重复进入 Active/Over 20 min | Auto |
| STAFF-QUEUE-11 | P1 | >24h 已关闭 | 检查 Carried over/Closed | 只进入 Closed | Auto |
| STAFF-QUEUE-12 | P1 | carried-over 支付阻断 | 同时满足两者 | Payment holds 优先，分类不重复 | Auto |
| STAFF-QUEUE-13 | P1 | 优先级条 | 核对 needs action/ready/over20/payment holds | 每个数字与相同数据快照逐单计算一致 | Auto |
| STAFF-QUEUE-14 | P1 | 点击优先级 pill | 逐个点击 | 切到 Orders 视图和对应队列；`aria-pressed` 正确 | Auto |
| STAFF-QUEUE-15 | P1 | 时间推进 | 不刷新页面跨过 20 分钟/24 小时 | 定时刷新后分类更新，不需重登 | Assisted |
| STAFF-QUEUE-16 | P1 | 状态/支付实时变化 | 另一会话更新订单 | 订单从旧队列移除并进入新队列，计数同步 | Assisted |

## 9. Orders 卡片内容（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-CARD-01 | P1 | Takeaway | 查看卡片 | 显示取餐码、外带、创建时间、等待时长 | Auto |
| STAFF-CARD-02 | P1 | DineIn | 查看卡片 | 显示桌号与堂食，不显示错误取餐信息 | Auto |
| STAFF-CARD-03 | P1 | 计划单 | 查看 scheduledTime | 时间与餐厅时区正确且标签可读 | Auto |
| STAFF-CARD-04 | P1 | 多币种 | 比较不同餐厅/订单 | 每单使用自己的币种，不借用当前筛选餐厅币种 | Auto |
| STAFF-CARD-05 | P1 | 商品数量与金额 | 查看多行订单 | 数量、行金额和总额与订单快照一致 | Auto |
| STAFF-CARD-06 | P1 | 选项组 | 查看含多个选项和数量的商品 | 组名、选项名、数量和价差完整 | Auto |
| STAFF-CARD-07 | P0 | 过敏/安全备注 | 输入 allergy/coeliac/peanut 等 | 显著显示 `Kitchen safety note`/`Item safety note`，不只靠颜色 | Auto |
| STAFF-CARD-08 | P1 | 普通备注 | 输入 extra napkins 等 | 显示普通备注，不误标过敏安全 | Auto |
| STAFF-CARD-09 | P0 | 全额退款行 | 查看厨房卡片 | 保留但划除，明确 refunded；不得继续显示为要制作数量 | Auto |
| STAFF-CARD-10 | P0 | 部分退款行 | 查看剩余数量 | 显示剩余制作数量和退款标记，计算不为负 | Auto |
| STAFF-CARD-11 | P1 | 顾客姓名 | 有/无 Customer | 有则显示必要姓名；无则布局不留空异常 | Auto |
| STAFF-CARD-12 | P1 | 状态/支付徽章 | 检查所有组合 | 文本和颜色一致；状态不能只靠颜色 | Auto |
| STAFF-CARD-13 | P1 | 长文本 | 长菜名、备注、选项、餐厅名 | 卡片可读，无按钮被挤出 | Assisted |
| STAFF-CARD-14 | P1 | 打印按钮 | 支付正常/阻断分别查看 | 正常可打印；支付阻断禁用，不产生打印任务 | Auto |
| STAFF-CARD-15 | P0 | 顾客名、菜名、选项和备注含 `<script>`、HTML、引号、双向控制符 | 打开 Orders/Kitchen/打印预览 | 全部按文本显示或安全规范化；不执行脚本、不注入属性、不遮蔽真实订单号/金额/动作 | Auto |
| STAFF-CARD-16 | P1 | 历史订单缺失菜名快照、顾客、更新时间或选项组名 | 打开 Orders/Kitchen | 使用可读 fallback（如 `Unnamed item`/`Options`），金额和按钮仍可用；不显示 `undefined`/`Invalid Date`/崩溃 | Auto |

## 10. Kitchen 看板（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-KITCHEN-01 | P1 | Pending 已付 | 切 Kitchen | 位于 New / Needs acceptance | Auto |
| STAFF-KITCHEN-02 | P1 | Accepted | 切 Kitchen | 位于 Preparing，主动作 Start cooking | Auto |
| STAFF-KITCHEN-03 | P1 | Preparing | 切 Kitchen | 位于 Preparing，主动作 Mark ready | Auto |
| STAFF-KITCHEN-04 | P1 | Ready | 切 Kitchen | 位于 Ready，主动作 Complete | Auto |
| STAFF-KITCHEN-05 | P0 | 支付阻断 | 切 Kitchen | 不进入任何厨房 lane | Auto |
| STAFF-KITCHEN-06 | P1 | Closed/carried-over | 切 Kitchen | 不进入厨房 lane | Auto |
| STAFF-KITCHEN-07 | P1 | Lane 数量 | 核对三列 badge | 与列内实际卡片数量一致 | Auto |
| STAFF-KITCHEN-08 | P1 | 空 lane | 清空某状态 | 显示该 lane 的可读空状态 | Auto |
| STAFF-KITCHEN-09 | P1 | 移动端 | 在 390/430px 切 New/Preparing/Ready | 每次只显示选中 lane，计数保留 | Assisted |
| STAFF-KITCHEN-10 | P1 | 排序 | 多个 Pending/Preparing/Ready | New 按付款等待优先，其他 lane 顺序符合厨房优先级 | Auto |
| STAFF-KITCHEN-11 | P0 | 备注/退款行 | 对比 Orders 与 Kitchen | 安全备注、选项、剩余制作数量两视图一致 | Auto |
| STAFF-KITCHEN-12 | P1 | 实时流转 | 在卡片连续完成标准流程 | 卡片依次跨 lane 移动，不重复、不消失到错误列 | Assisted |

## 11. Staff 状态流转（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-FLOW-01 | P1 | Pending eligible | Accept | →Accepted；提示成功；按钮防重入 | Auto |
| STAFF-FLOW-02 | P1 | Accepted eligible | Start cooking | →Preparing | Auto |
| STAFF-FLOW-03 | P1 | Preparing eligible | Mark ready | →Ready | Auto |
| STAFF-FLOW-04 | P1 | Ready eligible | Complete | →Completed 并进入 Closed | Auto |
| STAFF-FLOW-05 | P1 | Pending | Reject | 打开理由 Dialog；确认后→Rejected | Auto |
| STAFF-FLOW-06 | P1 | Accepted/Preparing/Ready | Cancel | 打开理由 Dialog；确认后→Cancelled | Auto |
| STAFF-FLOW-07 | P0 | 理由为空/纯空格 | 尝试确认 Reject/Cancel | Confirm disabled/服务端拒绝；状态不变 | Auto |
| STAFF-FLOW-08 | P1 | 放弃破坏性动作 | 点击 Keep current status、Esc、关闭 | 状态与历史不变；焦点返回触发按钮 | Assisted |
| STAFF-FLOW-09 | P0 | 非法快捷流转 | Staff 直接调用 Pending→MarkReady/Complete | 若岗位策略禁止则 403/409；UI 不暴露入口 | Auto |
| STAFF-FLOW-10 | P0 | 支付阻断订单 | 直接调用 Accept/StartPreparing/MarkReady/Complete | 服务端拒绝；状态不变 | Auto |
| STAFF-FLOW-11 | P1 | 快速双击动作 | 双击 Accept/Mark ready | 只产生一次流转和一条历史 | Auto |
| STAFF-FLOW-12 | P0 | 两个 Staff 会话 | 同时 Accept 同一单 | 一次成功；另一方明确冲突并刷新正确状态 | Assisted |
| STAFF-FLOW-13 | P1 | 请求中断 | 提交后立即刷新/断网 | 恢复后以服务器状态为准；无假成功/重复动作 | Auto |
| STAFF-FLOW-14 | P1 | 审计/副作用 | 核对成功和失败动作 | 成功含操作者/前后状态/理由；失败无成功审计 | Auto |
| STAFF-FLOW-15 | P0 | Completed/Cancelled/Rejected 且 API `availableActions` 含 Reopen | 在 Closed 队列查看并点击 Reopen | Reopen 按钮可见；必须填写理由，放弃不改状态，确认只提交一次 | Auto |
| STAFF-FLOW-16 | P0 | 三种终态分别 Reopen | 使用专用订单确认并核对队列/支付资格 | Cancelled/Rejected→Pending，Completed→Ready；支付阻断不能借 Reopen 绕过；历史记录操作者与理由 | Auto |

## 12. 柜台收款与退款请求（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-PAY-01 | P1 | PayAtCounter Unpaid | 查看 Orders/Kitchen | `Mark paid` 可见，厨房动作仍可用 | Auto |
| STAFF-PAY-02 | P0 | PayAtCounter | 点击 Mark paid | paymentStatus→Paid；paidAt/支付记录/金额/币种一致 | Auto |
| STAFF-PAY-03 | P0 | 已付订单 | 重复调用 Mark paid | 拒绝或幂等；不得记录两笔收入 | Auto |
| STAFF-PAY-04 | P0 | 跨店订单 | Staff A 调 B 的柜台收款 | 403；B 数据不变 | Auto |
| STAFF-PAY-05 | P1 | 已关闭/全退订单 | 尝试 Mark paid | 拒绝并说明；不得复活支付状态 | Auto |
| STAFF-PAY-06 | P1 | Pending refund request | 查看卡片 | 显示 `Customer has asked for a refund` 和 Review | Auto |
| STAFF-PAY-07 | P1 | Staff 无审批权限 | 点击 Review | 只能查看/按当前权限操作；不得绕过 Admin 退款权限 | Auto |
| STAFF-PAY-08 | P1 | Admin/Owner | Review approve/reject | 使用测试订单；状态、理由和页面刷新一致 | Assisted |
| STAFF-PAY-09 | P0 | 审批并发 | 两个管理员同时处理同一请求 | 只有一个有效结果；不重复退款 | Assisted |
| STAFF-PAY-10 | P1 | 处理完成 | 返回 Staff Orders | pending 提示消失；退款行和支付阻断及时更新 | Assisted |

## 13. 等待 SLA、提醒与声音（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-SLA-01 | P1 | 新已付 Pending | 查看等待计时 | 从支付完成/业务基准开始，不错误使用旧创建时间 | Auto |
| STAFF-SLA-02 | P1 | <20 分钟 | 查看信号标签 | Needs accept/Start cooking 等正常状态，无 late 样式 | Auto |
| STAFF-SLA-03 | P1 | ≥20 分钟 | 查看卡片与优先级条 | Needs accept now/late 样式与 Over 20 min 计数一致 | Auto |
| STAFF-SLA-04 | P1 | 时间格式 | 检查 <1m、分钟、小时 | 单位和舍入准确，不出现负数/NaN | Auto |
| STAFF-SLA-05 | P1 | 新订单音效 | 顾客创建已付订单 | 获得用户手势后播放一次新单提示 | Assisted |
| STAFF-SLA-06 | P1 | 未接单重复提醒 | 保持一张已付 Pending | 按策略重复提示，不形成高频连续噪声 | Assisted |
| STAFF-SLA-07 | P1 | 接单后 | Accept 当前提醒订单 | 重复提醒停止 | Assisted |
| STAFF-SLA-08 | P1 | 新单声音开关 | 静音/恢复 | 只控制新单音效；图标和 tooltip 状态一致 | Assisted |
| STAFF-SLA-09 | P1 | 超时提醒开关 | 静音/恢复 | 只控制未接单超时音效；不影响新单音效 | Assisted |
| STAFF-SLA-10 | P1 | 多标签页 | 两页同时打开并有打印站租约 | 声音策略不造成不可控重复；站立页行为明确 | Assisted |

## 14. 轮询、SignalR 与并发恢复（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-RT-01 | P1 | 页面保持打开 | 观察至少 45 秒 | 每约 15 秒刷新；无重叠请求和重复 toast | Auto |
| STAFF-RT-02 | P1 | 顾客下新单 | Staff 页面观察 | 无需手动刷新即可出现，计数和音效同步 | Assisted |
| STAFF-RT-03 | P1 | 两个 Staff 标签 | A 流转，B 观察 | B 及时更新；旧按钮不继续可用 | Assisted |
| STAFF-RT-04 | P1 | SignalR 断开 | 阻断 hub 但保留 REST | 页面有降级策略；轮询仍补齐数据 | Assisted |
| STAFF-RT-05 | P1 | SignalR 恢复 | 恢复网络 | 自动重连并补齐遗漏事件，不重复订单 | Assisted |
| STAFF-RT-06 | P1 | REST 断开、hub 有事件 | 触发刷新失败 | 不把旧列表清成 0；恢复后统一到服务器状态 | Auto |
| STAFF-RT-07 | P1 | 搜索中收到事件 | 当前过滤不匹配/匹配各一单 | 只显示符合当前搜索与队列的订单 | Assisted |
| STAFF-RT-08 | P0 | 并发状态与收款 | 一人 Mark paid，另一人流转 | 最终支付/订单状态合法，无半提交 | Assisted |
| STAFF-RT-09 | P1 | 浏览器休眠/唤醒 | 睡眠后恢复 | 数据、SignalR、QZ、租约和打印任务均重新同步 | Assisted |
| STAFF-RT-10 | P1 | 操作员停留在 Payment holds/Closed 或 Kitchen lane，并保留搜索 | 收到无关订单的 SignalR 事件 | 只刷新数据；不得强制跳回 Active、Orders 或清掉当前搜索/餐厅，除非当前对象已不再符合筛选并给出明确反馈 | Auto |

## 15. 打印设置、任务与恢复（25）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-PRINT-01 | P1 | Staff/Owner | 打开打印设置 | Kitchen/Front counter 两套独立配置可见 | Auto |
| STAFF-PRINT-02 | P1 | PlatformOwner | 选择 Print restaurant | 保存后打印站和自动打印只作用于该店 | Auto |
| STAFF-PRINT-03 | P0 | 未选打印餐厅 | 开启自动打印 | 阻止或保持暂停；页面明确提示 | Auto |
| STAFF-PRINT-04 | P1 | Route | 切 Browser/QZ/Web Serial/WebUSB/Web Bluetooth | 仅显示该路由相关字段；旧敏感状态不串用 | Auto |
| STAFF-PRINT-05 | P1 | Paper | 切换支持纸宽 | 测试票和真实票布局同步 | Assisted |
| STAFF-PRINT-06 | P1 | Cut/Beep | 分别开关 | 仅影响后续票；设置持久化 | Assisted |
| STAFF-PRINT-07 | P1 | QZ 正常 | 点击 Test connection | 合理时间内 Passed；打印机列表可刷新 | Auto |
| STAFF-PRINT-08 | P1 | QZ 启动中 | 刷新页面 | 显示 checking，不把连接窗口误报为 printer failure | Assisted |
| STAFF-PRINT-09 | P0 | 签名暂不可用 | 登录 Token 恢复前触发 QZ discovery | 不向 QZ 发送空签名；不弹 Invalid Signature 授权窗 | Assisted |
| STAFF-PRINT-10 | P0 | 可信证书 | 对比 QZ 证书、后端证书与私钥 | 证书一致、密钥配对、有效期有效；日志无 Bad signature | Auto |
| STAFF-PRINT-11 | P1 | 系统打印机 | 选择 printer 并 Check now | 队列存在且 health 正常时显示 ready | Auto |
| STAFF-PRINT-12 | P1 | 打印机消失/故障 | 拔线、关机、缺纸分别检测 | 明确 unreachable/status；QZ connected 不冒充 printer ready | Assisted |
| STAFF-PRINT-13 | P1 | Network 9100 | 正确/错误 IP 与端口 | 正确 reachable；错误超时并给可操作提示 | Assisted |
| STAFF-PRINT-14 | P1 | Serial/Bluetooth COM | 选择端口并测试 | 非打印状态请求通过；端口占用可恢复或提示 | Assisted |
| STAFF-PRINT-15 | P1 | WebUSB/Web Bluetooth | 用户手势选择设备 | 只连接用户选择设备；取消不报成功 | Assisted |
| STAFF-PRINT-16 | P1 | Print test ticket | 用户明确授权后打印 | 餐厅、标题、中文/英文、金额、纸宽、切纸、蜂鸣正确 | Assisted |
| STAFF-PRINT-17 | P0 | 手动打印订单 | 点击订单打印按钮 | 只生成该订单一张票；支付阻断时不打印 | Assisted |
| STAFF-PRINT-18 | P0 | 自动打印 | 新的可打印订单进入 | 只由持有租约的站点打印一次 | Assisted |
| STAFF-PRINT-19 | P0 | 两标签/两电脑 | 同店同时打开自动打印 | 一方持有租约；standby 方不重复出票 | Assisted |
| STAFF-PRINT-20 | P1 | 打印失败 | 断开打印机后产生测试订单 | 任务进入 Failed/DeadLetter，页面和全局通知一致 | Assisted |
| STAFF-PRINT-21 | P0 | Retry | 恢复打印机后重试失败任务 | 只补打目标任务一次；状态最终 Printed | Assisted |
| STAFF-PRINT-22 | P1 | Clear queue | 未经授权查看按钮但不执行；授权后限定目标 | 不误清其他打印机/真实队列；结果可审计 | Assisted |
| STAFF-PRINT-23 | P1 | Diagnostics | 下载诊断 JSON | 包含连接/队列/失败时间线；不含 Token、签名、私钥或顾客敏感数据 | Auto |
| STAFF-PRINT-24 | P1 | 30–50 单耐久 | 已授权测试批次 | 无漏打、重复、乱序；物理计数与任务记录一致 | Assisted |
| STAFF-PRINT-25 | P1 | 已对 printer A 得到 ready | 改选 printer B/route/host/port 后立即观察并检测 | A 的成功状态立刻失效并显示 checking/not tested；完成 B 检测前不得沿用 A 的 ready 或 Last printed 证明 | Auto |

## 16. 恢复、无障碍与响应式（15）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| STAFF-REC-01 | P1 | 纯键盘 | 切视图/队列、搜索、排序、流转、打印设置 | 焦点顺序合理可见；无键盘陷阱 | Assisted |
| STAFF-REC-02 | P1 | Dialog | 打开 Reject/Cancel/Printer，Esc/关闭 | 关闭后焦点返回触发器；操作中不能误关 | Assisted |
| STAFF-REC-03 | P1 | 屏幕阅读器 | 读取 H1、汇总、队列、卡片、状态变化 | 数字与标签成组；动态变化有合适 live region | Assisted |
| STAFF-REC-04 | P1 | 控件命名 | 检查图标按钮、声音、打印、清除搜索 | 均有唯一可读名称，不依赖 tooltip | Auto |
| STAFF-REC-05 | P1 | 对比与状态 | 浅色/深色/高对比度 | New/late/payment/refund/safety 不只靠颜色 | Assisted |
| STAFF-REC-06 | P1 | 390/430px | 完成搜索→Kitchen→Accept→打印设置只读 | 无横向溢出；底部按钮可见可点 | Assisted |
| STAFF-REC-07 | P1 | 平板/200% zoom | 重复关键操作 | 三列安全降级；Dialog 可滚动和关闭 | Assisted |
| STAFF-REC-08 | P2 | Reduced motion | 开启后切队列和实时更新 | 动画减弱；功能和状态仍可理解 | Assisted |
| STAFF-REC-09 | P1 | 长列表 | 100 条订单滚动、切队列、返回 | 性能可接受；焦点/滚动位置策略稳定 | Assisted |
| STAFF-REC-10 | P1 | 时区/DST | 餐厅时区跨 DST 边界 | 创建时间、计划时间、等待时长不跳错 | Auto |
| STAFF-REC-11 | P1 | 前端单测 | 运行 staffOrderManagement/orderStats/打印专项 | 分类、支付阻断、安全备注、租约和打印恢复断言通过 | Auto |
| STAFF-REC-12 | P1 | 后端单测 | 运行 Staff orders、流转、收款、打印任务授权测试 | 关键权限和并发无 skip | Auto |
| STAFF-REC-13 | P1 | 安全错误 | 触发 400/401/403/404/409/429/500/503 | 无 SQL、堆栈、Token、签名、私钥或完整 Stripe ID | Auto |
| STAFF-REC-14 | P1 | 测试结束 | 核对订单、支付、打印任务、设置和证据 | 可逆配置恢复；不可逆出票如实记录；无真实数据残留 | Auto |
| STAFF-REC-15 | P1 | 搜索、队列、Dialog 和实时刷新均会动态更新 DOM | 使用键盘或屏幕阅读器操作并等待一次轮询 | 焦点不因卡片重排丢到 body；搜索输入不失焦；Dialog 关闭后回到原按钮；刷新结果有非打断式状态通知 | Assisted |

## 17. 推荐执行顺序

1. `STAFF-PRE-*`：环境、账号、订单矩阵、打印目标和用户手势。
2. `STAFF-ROLE-*`：先钉死路由、租户和岗位权限。
3. `STAFF-PAGE-*`、`STAFF-LIST-*`、`STAFF-QUEUE-*`：全部只读功能。
4. `STAFF-CARD-*`、`STAFF-KITCHEN-*`：内容和厨房视图。
5. `STAFF-FLOW-*`：用一次性订单跑标准渐进流程和并发冲突。
6. `STAFF-PAY-*`：柜台收款与退款请求；只用 Test/Sandbox 数据。
7. `STAFF-SLA-*`、`STAFF-RT-*`：需要等待、音频和多会话。
8. `STAFF-PRINT-01`–`15` 先做非打印检测；实体票 `16`–`24` 必须获得授权和人工观察。
9. `STAFF-REC-*`：无障碍、响应式、自动化和清理。

## 18. 用户接力

| 场景 | 用户操作 | Agent 后续核对 |
|---|---|---|
| 音效 | 确认听到新单与超时两种声音 | 开关隔离、次数和停止条件 |
| 实体票 | 授权打印一张测试票并观察 | 内容、纸宽、切纸、蜂鸣、重复 |
| 断纸/断线 | 安全地断开测试打印机再恢复 | 失败任务、通知、重试和去重 |
| 多设备 | 第二台设备登录同店 Staff | SignalR、并发冲突、打印站租约 |
| 手机 | 真机完成一次 Accept→Start cooking→Mark ready | 触控尺寸、Dialog、无溢出 |

## 19. 完成标准

- 所有被选择的 `STAFF-*` 均记录 PASS/FAIL/BLOCKED/NOT RUN；未观察实体票不得标 PASS。
- P0 必须为 0：跨租户读写、支付阻断仍可履约、重复状态流转、重复收款、空签名 QZ 请求、重复自动打印、退款审批越权均为发布阻断。
- Orders、Kitchen、打印票三处的菜品、选项、安全备注和退款后剩余制作数量一致。
- 页面轮询、SignalR 与多标签并发最终收敛到同一服务器状态。
- 打印连接、打印机 readiness、打印任务状态与物理出票四层分别记录，不互相冒充。
- 本包通过不代表 Stripe 资金、顾客下单、Admin Orders 或完整 release/full 验收通过。
