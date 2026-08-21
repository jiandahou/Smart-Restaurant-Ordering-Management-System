# DineFlow Front Counter 专项测试用例

测试包名称：`front-counter`  
稳定用例前缀：`FC-*`  
目标页面：`/staff/front-counter`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `front-counter`、指定 `FC-*`，或明确要求 `full` 时才执行。

本测试包覆盖前台取餐、堂食桌台、柜台现金/刷卡收款、找零、完成订单、整桌结算、柜台收款冲正、收据打印、搜索队列、实时刷新、权限与恢复。

相邻测试包不要重复执行：

- 厨房接单、制作、Ready 和厨房票 → [staff-orders-test-cases.md](staff-orders-test-cases.md)
- Admin 订单历史、状态管理、Stripe 退款 → [admin-orders-test-cases.md](admin-orders-test-cases.md)
- 顾客购物车、下单、桌台 Cart/Token → [cart-test-cases.md](cart-test-cases.md)
- 打印站 QZ 连接、租约和物理恢复 → Staff Orders 的 `STAFF-PRINT-*`

## 1. 执行与安全规则

- 写操作只允许在 Local/Test/Staging；Production 默认只读。
- 收款、完成、整桌结算、Void、offline refund 和打印必须使用本轮专用订单/桌台。
- 柜台现金/刷卡是本地记录，不等同 Stripe 在线扣款；两者不得混记。
- Void/Refund 会改变账务与审计，不能用长期夹具；测试前记录支付、状态、Session、历史和汇总基线。
- 实体收据、切纸、蜂鸣、断线和清队列必须单独获得授权，并由用户观察后才能 PASS。
- 报告不得包含顾客完整邮箱/电话、完整支付标识、Token、QZ 签名或私钥。

## 2. 当前功能基线

| 区域 | 当前行为 |
|---|---|
| Takeaway & dine-in | 展示未关闭订单，并按餐厅 business date 分组 |
| Tables | 展示桌台、开放 Session、合并商品、活跃订单和历史订单 |
| 类型筛选 | All / Takeaway / Dine in |
| 工作队列 | Ready pickup / Payment due / Payment issues / Carried over / All active |
| 柜台动作 | Record payment / Take payment & complete / Complete pickup |
| Tender | Card 或 Cash；现金必须不少于应收并计算 change |
| 冲正 | 无退款的柜台付款可 Void；已有退款时只可 offline refund |
| 收据 | 单订单收据和整桌合并收据；支持 Browser/QZ 等 Front counter 打印配置 |
| 更新 | 首次加载、手动刷新、每 15 秒轮询、SignalR 事件后 300ms 合并刷新 |

## 3. 推荐测试夹具

| 夹具 | 最低要求 |
|---|---|
| Staff A/B | 分属两个餐厅，用于租户隔离 |
| 同店 Staff A1/A2 | 两个会话，用于收款/结算并发 |
| PlatformOwner | 至少两个不同币种/时区餐厅 |
| Takeaway 矩阵 | Pending/Accepted/Preparing/Ready；Online/PayAtCounter；各种支付状态 |
| 桌台矩阵 | Idle、单订单、多订单、混合支付、支付阻断、carried-over、历史订单 |
| Tender 矩阵 | Card、现金刚好、现金超额、现金不足、小数/极大值 |
| 冲正矩阵 | clean counter payment、partially refunded、fully refunded、online payment |
| 内容矩阵 | 选项、数量、备注、安全备注、退款行、长文本、多币种 |
| 打印终端 | QZ + 专用前台打印机 + 测试纸 |

## 4. 前置检查（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-PRE-01 | P1 | 项目目录 | 记录环境、分支、提交、dirty 数量和端点 | 明确不是误用 Production | Auto |
| FC-PRE-02 | P1 | 角色账号 | 核对 role、userId、restaurantId | 身份和租户范围明确 | Auto |
| FC-PRE-03 | P1 | 订单矩阵 | 导出订单/支付/金额/Session/历史基线 | 写操作后可精确核对 | Auto |
| FC-PRE-04 | P1 | 两店数据 | A/B 各准备唯一订单、桌台与 Session | 越权检查不会误判 | Auto |
| FC-PRE-05 | P1 | 餐厅配置 | 记录时区、business date、币种、GST/ABN | 分组和收据有基线 | Auto |
| FC-PRE-06 | P1 | 实时 | 记录 SignalR 与轮询状态 | 实时用例有基线 | Auto |
| FC-PRE-07 | P1 | 打印 | 核对 Front counter route、printer、纸宽、是否测试队列 | 不误打真实前台 | Assisted |
| FC-PRE-08 | P1 | 一次性数据 | 为收款、完成、整桌结算、Void/Refund 分配专用订单 | 不污染长期夹具 | Auto |

## 5. 路由、角色与租户隔离（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-ROLE-01 | P1 | 未登录 | 打开/刷新 `/staff/front-counter` | 跳转登录；不闪现订单或金额 | Auto |
| FC-ROLE-02 | P1 | Customer/Guest | 直接打开页面 | Access denied/安全跳转；无数据闪现 | Auto |
| FC-ROLE-03 | P0 | Customer Token | 调 Front Counter API | 403；不可作为 Staff 凭证 | Auto |
| FC-ROLE-04 | P1 | Staff A | 打开页面 | 只见餐厅 A；无餐厅选择器 | Auto |
| FC-ROLE-05 | P0 | Staff A | 搜餐厅 B 订单号、顾客、桌号、菜品 | 0 结果；不泄露 B 是否存在 | Auto |
| FC-ROLE-06 | P0 | Staff A + B 资源 id | 调收款、完成、整桌结算、Void/Refund | 403/404；B 数据完全不变 | Auto |
| FC-ROLE-07 | P1 | 未分配餐厅 Staff | 打开页面和调 API | 明确 403；不伪装空前台 | Auto |
| FC-ROLE-08 | P1 | Owner/Admin/Staff A | 比较页面能力 | 均按 StaffApi 工作且仍限 A；无后台越权 | Auto |
| FC-ROLE-09 | P1 | PlatformOwner | 首次打开 | 必须选择单一餐厅；不能跨店混合结算 | Auto |
| FC-ROLE-10 | P0 | PlatformOwner 选 A | 切到 B 时有 A 请求在途 | 最终仅显示 B；A 响应不能覆盖 | Auto |
| FC-ROLE-11 | P1 | 同浏览器切账号 | Staff A→Staff B→Customer | 搜索、选店、选桌、Dialog 和可用动作全部重置 | Auto |
| FC-ROLE-12 | P1 | 账号被禁用/降级 | 保留旧页后刷新并尝试收款 | 当前权限拒绝；旧页面不能继续动钱 | Assisted |

## 6. 页面加载、刷新与实时恢复（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-PAGE-01 | P1 | 正常环境 | 首次打开 | 唯一 H1 `Front Counter`；范围和更新时间清楚 | Auto |
| FC-PAGE-02 | P1 | 首次加载 | 观察 Takeaway/Tables loading | 不先闪空状态；选桌详情有独立 loading | Auto |
| FC-PAGE-03 | P1 | 手动刷新 | 点击 Refresh | 防重入、更新时间更新、成功提示一次 | Auto |
| FC-PAGE-04 | P1 | 快速双击 Refresh | 连点两次 | 无乱序覆盖、重复 toast 或选桌跳动 | Auto |
| FC-PAGE-05 | P1 | 一个列表 API 失败 | takeaway/tables 分别 500 | 错误可读；不把旧数据伪装为新成功 | Auto |
| FC-PAGE-06 | P1 | 选桌详情失败 | 点击桌台并返回 404/500 | 只清理错误选择；主列表仍可用 | Auto |
| FC-PAGE-07 | P1 | 401/403/429 | 加载或动作时会话过期/失权/限流 | 安全提示并可恢复；不显示堆栈或旧租户数据 | Auto |
| FC-PAGE-08 | P1 | 慢请求乱序 | 快速搜词、切店、选桌 | 最新选择胜出；旧响应不覆盖 | Auto |
| FC-PAGE-09 | P1 | 页面保持 45 秒 | 观察轮询 | 每约 15 秒更新，无重叠请求或重复提示 | Auto |
| FC-PAGE-10 | P1 | SignalR 多事件 | 300ms 内连续 created/updated/payment | 合并刷新；订单不重复，选桌尽量保留 | Auto |
| FC-PAGE-11 | P1 | Hub 断线/重连 | 保留 REST 后断开再恢复 | 轮询继续；重连补齐数据 | Assisted |
| FC-PAGE-12 | P1 | 后台休眠/唤醒 | 恢复页面 | 列表、选桌、支付状态、打印状态重新同步 | Assisted |

## 7. 搜索、筛选、上限与营业日分组（15）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-LIST-01 | P1 | 默认 | 打开页面 | 默认 Ready pickup、All 类型、pageSize 100 | Auto |
| FC-LIST-02 | P1 | 订单号/取餐号 | 搜完整、部分、`#008`/`008`/`8` | 250ms 后正确命中 | Auto |
| FC-LIST-03 | P1 | 顾客 | 搜姓名和邮箱片段 | 正确命中；页面不额外显示完整邮箱 | Auto |
| FC-LIST-04 | P1 | 桌号/菜品 | 搜本店桌号和菜品 | Takeaway/Tables 结果均按契约过滤 | Auto |
| FC-LIST-05 | P1 | 特殊字符 | `%`、`_`、引号、emoji、空格 | 字面安全匹配/空结果；无 SQL/500 | Auto |
| FC-LIST-06 | P1 | 快速输入 | 连续输入 10 字符 | debounce 仅以最终值查询 | Auto |
| FC-LIST-07 | P1 | 清除 | 点击 clear | 搜索、结果、上限恢复；焦点合理 | Auto |
| FC-LIST-08 | P1 | 类型筛选 | All/Takeaway/Dine in | 只改变卡片类型；队列计数口径明确 | Auto |
| FC-LIST-09 | P1 | 队列+类型+搜索 | 组合切换 | 三者取交集且条件保留 | Auto |
| FC-LIST-10 | P1 | >100 条 | 点击 Load more 多次 | 每次增加且不重复；达到总数后按钮消失 | Auto |
| FC-LIST-11 | P1 | 搜索变化 | 已加载 >100 后改词 | 上限重置 100，不沿用旧总数 | Auto |
| FC-LIST-12 | P1 | business date | 浏览器时区不同于餐厅 | Today/Yesterday/Tomorrow 以餐厅日期分组 | Auto |
| FC-LIST-13 | P1 | 重复取餐号 | 昨日和今日均有 #003 | 日期标题清楚，不能误认同一单 | Auto |
| FC-LIST-14 | P1 | pickupDate null | 查看未分配与历史未分配 | 显示 Awaiting number 或 Carried over · no pickup number | Auto |
| FC-LIST-15 | P1 | 空结果 | 搜不存在内容并切空队列/桌台 | 搜索空状态与真正空状态可区分 | Auto |

## 8. 队列、日期和汇总（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-QUEUE-01 | P1 | Ready + 已付/NotRequired | 检查 Ready pickup | 进入且可 Complete pickup | Auto |
| FC-QUEUE-02 | P1 | Ready + PayAtCounter Unpaid | 检查 Ready/Payment due | 两者口径符合设计；主动作 Take payment & complete | Auto |
| FC-QUEUE-03 | P1 | 非 Ready + PayAtCounter Unpaid | 检查 Payment due | 可 Record payment，但不可提前完成 | Auto |
| FC-QUEUE-04 | P0 | Online Pending/Failed/Expired/Cancelled | 检查 Payment issues | 进入且无收款/完成入口 | Auto |
| FC-QUEUE-05 | P0 | Refunded | 检查 Payment issues | 明确 Fully refunded，不可再收费/完成 | Auto |
| FC-QUEUE-06 | P1 | 旧 business date 活跃单 | 检查 Carried over | 进入并低于今日工作排序 | Auto |
| FC-QUEUE-07 | P1 | Closed | Completed/Cancelled/Rejected | 不在任何 active 队列，只在桌台 history | Auto |
| FC-QUEUE-08 | P1 | All active | 核对逐单 | 包含所有未关闭单且不重复 | Auto |
| FC-QUEUE-09 | P1 | 汇总 Ready | 与卡片逐单核对 | 数量同一数据快照一致 | Auto |
| FC-QUEUE-10 | P1 | Payment due 总额 | 多个币种/多种支付状态 | 只加 counter due；不得跨币种合并成单一金额 | Auto |
| FC-QUEUE-11 | P1 | Open tables/active orders | 对照 Tables | Session 与订单数一致 | Auto |
| FC-QUEUE-12 | P1 | 实时状态变化 | Kitchen 将单标 Ready/取消 | 卡片、队列、汇总同步移动 | Assisted |

## 9. 订单卡片内容与动作（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-CARD-01 | P1 | Takeaway | 查看卡片 | 取餐码、订单号、时间、状态、支付、金额完整 | Auto |
| FC-CARD-02 | P1 | DineIn | 查看卡片 | 桌号与堂食标签清楚；可 Open table | Auto |
| FC-CARD-03 | P1 | Scheduled | 查看卡片 | 计划时间按餐厅时区可读 | Auto |
| FC-CARD-04 | P1 | 顾客有/无姓名 | 查看布局 | 最小必要姓名；无顾客不留异常空位 | Auto |
| FC-CARD-05 | P1 | 多商品/数量/金额 | 对比订单快照 | 行金额和总额一致 | Auto |
| FC-CARD-06 | P1 | 选项组 | 查看选项、数量、价差 | 完整且与 Cart/Staff/收据一致 | Auto |
| FC-CARD-07 | P0 | 过敏安全备注 | 查看订单与商品备注 | 显著文本+图标，不只靠颜色 | Auto |
| FC-CARD-08 | P1 | 普通备注 | 查看 | 不误标安全风险 | Auto |
| FC-CARD-09 | P0 | 部分/全部退款商品 | 查看卡片与金额 | 剩余数量/退款状态正确，不提示再次收费全额 | Auto |
| FC-CARD-10 | P1 | 长文本/特殊字符 | 查看卡片 | 不溢出、不执行 HTML/script、不遮蔽动作 | Assisted |
| FC-CARD-11 | P1 | 每种阻断 | 悬停/聚焦禁用动作 | tooltip/文本准确解释等待厨房或支付问题 | Auto |
| FC-CARD-12 | P1 | 打印按钮 | 键盘/鼠标查看 | 唯一可读名称；打印目标是当前订单 | Auto |

## 10. 单订单收款与完成（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-ORDER-01 | P1 | 非 Ready counter due | Record payment | 仅 payment→Paid，订单状态不变 | Auto |
| FC-ORDER-02 | P0 | Ready counter due | Take payment & complete | 一次确认后 Paid + Completed；记录支付和状态历史 | Auto |
| FC-ORDER-03 | P1 | Ready online Paid | Complete pickup | 不新增柜台 Payment，只完成订单 | Auto |
| FC-ORDER-04 | P1 | Ready PartiallyRefunded | Complete pickup | 可完成且不再次收费 | Auto |
| FC-ORDER-05 | P0 | Ready Refunded | 尝试动作/UI/API | 拒绝；状态和支付不变 | Auto |
| FC-ORDER-06 | P0 | Online Pending/Failed | 尝试柜台动作/API | 不能用柜台收款绕过在线支付问题 | Auto |
| FC-ORDER-07 | P0 | 非 Ready 已付 | 直接 Complete API | 409；不得跳过厨房 | Auto |
| FC-ORDER-08 | P0 | 已完成订单 | 重复收款/完成 | 409/幂等；不新增支付或历史 | Auto |
| FC-ORDER-09 | P0 | 两个 Staff | 同时 Take payment & complete | 只有一次付款/一次完成；另一方明确冲突 | Assisted |
| FC-ORDER-10 | P1 | 快速双击确认 | 双击/Enter 连按 | 按钮防重入；单次副作用 | Auto |
| FC-ORDER-11 | P1 | 取消 Dialog | Cancel/Esc/关闭 | 无状态、支付或审计变化 | Auto |
| FC-ORDER-12 | P1 | 收款成功、完成失败 | 注入第二请求失败 | 页面明确显示已收款但未完成；刷新后可安全只完成 | Auto |
| FC-ORDER-13 | P1 | 请求中断 | 确认后立即刷新/断网 | 恢复后以服务器为准，不提示重复收费 | Assisted |
| FC-ORDER-14 | P1 | 订单属于桌台 | 完成最后/非最后订单 | 仅最后活跃单完成时关闭 Session | Auto |
| FC-ORDER-15 | P1 | 成功动作 | 核对 SignalR/汇总/收据提示 | 列表同步且只出现一次 Print receipt 提示 | Auto |
| FC-ORDER-16 | P1 | 审计 | 核对成功与失败 | 操作者、tender、金额、找零、状态变化完整；失败无成功审计 | Auto |

## 11. Tender、金额与找零（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-TENDER-01 | P1 | 默认 Dialog | 打开收款 | 默认 Card；应收金额正确 | Auto |
| FC-TENDER-02 | P1 | Card | 确认 | provider=CounterCard；received=应收；change=0 | Auto |
| FC-TENDER-03 | P1 | Cash 刚好 | 输入精确应收 | 可确认；change=0 | Auto |
| FC-TENDER-04 | P1 | Cash 超额 | 输入大于应收 | 即时显示正确 change 并持久化 | Auto |
| FC-TENDER-05 | P0 | Cash 不足 | 空、0、负数、小于应收 | Confirm 禁用且 API 400；不得收款 | Auto |
| FC-TENDER-06 | P1 | Cash 非法文本 | 字母、NaN、Infinity、指数、多个小数点 | 安全拒绝；无 NaN/崩溃 | Auto |
| FC-TENDER-07 | P1 | 小数精度 | 0.01、10.005、超额边界 | 使用货币最小单位，无浮点少收/多找 | Auto |
| FC-TENDER-08 | P1 | 极大值 | 超长数字/超上限 | 前后端拒绝或安全处理，无溢出 | Auto |
| FC-TENDER-09 | P0 | 非法 tender API | Cash/Card 之外 | 400；不默认当 Card | Auto |
| FC-TENDER-10 | P1 | amountDue=0 | 已付订单完成 | 不要求现金，不记录 received/change | Auto |
| FC-TENDER-11 | P1 | 多币种 | AUD/INR 等餐厅 | 输入、格式、Payment currency 和收据一致 | Auto |
| FC-TENDER-12 | P1 | 切 tender | Cash 输入后切 Card 再切回 | 不把陈旧现金值误提交；状态策略明确 | Auto |
| FC-TENDER-13 | P1 | 前后端金额变化 | Dialog 打开后订单金额被更新 | 提交冲突/刷新最新金额；不得按旧金额收费 | Assisted |
| FC-TENDER-14 | P0 | 重放请求 | 相同订单重复 record-payment | 只存在一笔有效柜台收入 | Auto |

## 12. 柜台支付 Void 与 Offline Refund（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-REV-01 | P0 | clean Counter Paid、0 refund | 打开动作 | 只显示 Void payment | Auto |
| FC-REV-02 | P0 | Counter Paid 有可退余额/已有退款 | 打开动作 | 显示 Refund，不允许 Void 抹掉历史 | Auto |
| FC-REV-03 | P0 | Online/Stripe payment | 查看卡片/API | 不显示柜台冲正；直接调用拒绝 | Auto |
| FC-REV-04 | P1 | Void | 理由为空/空格 | Confirm 禁用/服务端拒绝 | Auto |
| FC-REV-05 | P0 | Void 成功 | 使用专用订单确认 | Payment 恢复 unpaid/可支付；原支付状态、审计和事件正确 | Auto |
| FC-REV-06 | P0 | Offline refund 成功 | 确认全部可退余额 | 金额/币种/状态/refundCount/refundable amount 正确 | Auto |
| FC-REV-07 | P0 | 重复 Void/Refund | 重放 | 409/幂等；不得负余额或重复退款 | Auto |
| FC-REV-08 | P0 | 两 Staff 并发冲正 | 同时提交 | 一个成功；另一个冲突并刷新 | Assisted |
| FC-REV-09 | P0 | 跨店 paymentId | Staff A 调 B | 403/404；B 不变 | Auto |
| FC-REV-10 | P1 | Completed 订单冲正 | Void/Refund 后查看订单 | 账务状态诚实；不得自动重开厨房状态 | Auto |
| FC-REV-11 | P1 | 失败/中断 | 注入 DB/API 错误 | 支付、退款、审计原子一致 | Auto |
| FC-REV-12 | P1 | 完成后 | 核对通知、列表、收据 | 金额和动作及时更新，不沿用旧 Paid 收据 | Auto |

## 13. 桌台、Session、合并账单与整桌结算（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-TABLE-01 | P1 | Active/Inactive tables | 打开 Tables | 只显示本店 active table，排序稳定 | Auto |
| FC-TABLE-02 | P1 | Idle/Open | 核对卡片 | Session、订单数、商品数、应收和最新状态准确 | Auto |
| FC-TABLE-03 | P1 | 点击桌台 | 快速切 A→B | B 详情胜出；A 旧响应不覆盖 | Auto |
| FC-TABLE-04 | P1 | 选中桌台 | 轮询/搜索刷新 | 桌台仍存在则保持选择，否则安全清理 | Auto |
| FC-TABLE-05 | P1 | 多订单同桌 | 查看 active/history | 未关闭只在 active；closed 只在 history | Auto |
| FC-TABLE-06 | P1 | 相同商品/选项/备注 | 查看 merged items | 仅键完全相同才合并；数量金额相加正确 | Auto |
| FC-TABLE-07 | P0 | 同商品不同选项/备注 | 查看 | 不错误合并，厨房安全备注不丢 | Auto |
| FC-TABLE-08 | P1 | 商品有退款 | 查看 merged bill | 应制作/应收数量和金额不被重复计算 | Auto |
| FC-TABLE-09 | P1 | 无 active bill | 点击 Settle table | 阻止并说明 | Auto |
| FC-TABLE-10 | P0 | 任一 active order 非 Ready | 尝试结算 | 整桌拒绝；没有订单被收费/完成 | Auto |
| FC-TABLE-11 | P0 | 任一 online payment issue/refunded | 尝试结算 | 整桌拒绝且原子不变 | Auto |
| FC-TABLE-12 | P1 | 全部 Ready，混合 online paid + counter due | Card 结算 | 只为 counter due 建支付；全部完成；Session 关闭 | Auto |
| FC-TABLE-13 | P1 | 全部 Ready，全部已付 | 结算 | amountDue=0；不新增支付；全部完成 | Auto |
| FC-TABLE-14 | P1 | Cash 整桌 | 刚好/超额 | 总应收、received、change 正确且只记录在应收订单 | Auto |
| FC-TABLE-15 | P0 | 多订单结算中途失败 | 注入第二单/SaveChanges 错误 | transaction 回滚；不得半桌 Paid/Completed | Auto |
| FC-TABLE-16 | P0 | 两 Staff 同时结算 | 并发提交 | 只有一个成功；无重复支付/完成 | Assisted |
| FC-TABLE-17 | P1 | 完成一张非最后订单 | 查看 Session | Session 仍 Open | Auto |
| FC-TABLE-18 | P1 | 完成最后活跃订单 | 查看 Session | Session Closed、ClosedAt/UpdatedAt 正确 | Auto |
| FC-TABLE-19 | P1 | 新 Session 同一桌 | 旧 Session 关闭后顾客重新入座 | 新旧账单隔离；历史不混入应收 | Auto |
| FC-TABLE-20 | P0 | 跨店 table/session id | 直接 GET/settle | 403/404；不泄露桌号、金额或历史 | Auto |

## 14. 收据、打印提示与打印路由（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-RCPT-01 | P1 | 收款/完成成功 | 查看 Print receipt? | 仅成功后出现一次；Cancel 不打印 | Auto |
| FC-RCPT-02 | P1 | 单订单未付/已付 | 对比标题 | GST 注册时 Tax Invoice 规则正确；未付账单不伪装已付收据 | Auto |
| FC-RCPT-03 | P1 | 餐厅身份 | 查看收据 | restaurant/legal name/ABN/address/phone 按配置显示 | Auto |
| FC-RCPT-04 | P1 | Takeaway/DineIn | 查看 code/scope | 取餐码、桌号、订单号和类型清楚 | Auto |
| FC-RCPT-05 | P1 | 商品/选项/备注 | 对比页面/订单 | 数量、价格、选项、备注一致 | Auto |
| FC-RCPT-06 | P1 | GST | 注册/未注册餐厅 | GST included 金额和文案准确 | Auto |
| FC-RCPT-07 | P1 | Card/Cash | 对比 | tender、received、change、amountDue 准确 | Auto |
| FC-RCPT-08 | P1 | Void/Refund 后 | 重打 | 支付/退款状态诚实，不沿用旧 Paid 快照 | Auto |
| FC-RCPT-09 | P1 | 整桌收据 | 多订单合并 | merged items、订单数、商品数、总额、应收和桌号正确 | Auto |
| FC-RCPT-10 | P1 | 历史桌台无 active bill | Print latest receipt | 打印最新历史订单，不生成空整桌账单 | Auto |
| FC-RCPT-11 | P1 | 浏览器打印 | 打开后取消/完成 | 页面恢复；不重复弹窗；打印 CSS 只显示收据 | Assisted |
| FC-RCPT-12 | P1 | QZ Front counter route | 非物理连接检查 | 使用 Front counter 配置，不误用 Kitchen printer | Auto |
| FC-RCPT-13 | P0 | 自动/手动重打 | 两标签操作同一收据 | 每次用户动作只产生一份目标收据 | Assisted |
| FC-RCPT-14 | P1 | 58/80mm、中文/长文本 | 用户授权打印 | 可读、换行、切纸/蜂鸣符合设置 | Assisted |
| FC-RCPT-15 | P1 | 打印失败 | QZ/打印机断开 | 收款仍成功；打印失败清楚且可安全重打 | Assisted |
| FC-RCPT-16 | P1 | 隐私 | 检查屏幕、收据、诊断 | 不打印完整邮箱、Token、支付内部 ID 或安全备注之外的敏感信息 | Auto |

## 15. 恢复、无障碍、响应式与自动化（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| FC-REC-01 | P1 | 纯键盘 | 搜索、筛选、选桌、收款、收据 Dialog | 焦点顺序合理、可见、无陷阱 | Assisted |
| FC-REC-02 | P1 | Dialog | Esc/Cancel/提交中尝试关闭 | 未提交可安全退出；提交中防误关；焦点返回 | Assisted |
| FC-REC-03 | P1 | 屏幕阅读器 | 读取 H1、汇总、队列、卡片、桌台、找零 | 标签与数字成组；动态状态有合适 live region | Assisted |
| FC-REC-04 | P1 | 图标按钮 | clear/refresh/print/Open table | 均有唯一可读名称 | Auto |
| FC-REC-05 | P1 | 390/430px | 完成搜索→收款 Dialog→Tables | 无横向溢出；金额和确认按钮可见 | Assisted |
| FC-REC-06 | P1 | 平板/200% zoom | 选桌并整桌结算 | 双栏安全降级、Dialog 可滚动关闭 | Assisted |
| FC-REC-07 | P1 | 浅/深/高对比 | 支付 issue、安全备注、carried over | 不只靠颜色表达 | Assisted |
| FC-REC-08 | P2 | Reduced motion | 切页签和实时更新 | 动画减弱且状态仍清楚 | Assisted |
| FC-REC-09 | P1 | 100+ 长列表 | Load more、搜索、返回 | 性能可接受；焦点/滚动策略稳定 | Assisted |
| FC-REC-10 | P1 | 时区/DST | 跨营业日边界 | 分组、时间和 carried-over 不跳错 | Auto |
| FC-REC-11 | P1 | 前端测试 | 运行 frontCounterManagement/receipt/printing | 队列、动作、找零、收据断言通过 | Auto |
| FC-REC-12 | P1 | 后端测试 | 运行 FrontCounter policy/API/concurrency | 权限、原子性、幂等无 skip | Auto |
| FC-REC-13 | P1 | 安全错误 | 400/401/403/404/409/429/500/503 | 无 SQL、堆栈、Token 或完整支付 ID | Auto |
| FC-REC-14 | P1 | 测试结束 | 核对订单、支付、Session、打印和证据 | 可逆配置恢复；无真实数据残留 | Auto |

## 16. 推荐执行顺序

1. `FC-PRE-*`、`FC-ROLE-*`：环境、账号和租户边界。
2. `FC-PAGE-*`、`FC-LIST-*`、`FC-QUEUE-*`、`FC-CARD-*`：只读页面与分类。
3. `FC-ORDER-*`、`FC-TENDER-*`：专用 Takeaway/DineIn 订单收款与完成。
4. `FC-REV-*`：只用本轮柜台 Payment 做 Void/Refund。
5. `FC-TABLE-*`：专用桌台 Session 和并发整桌结算。
6. `FC-RCPT-01..12,16`：先做预览/连接；实体票 `13..15` 必须用户授权观察。
7. `FC-REC-*`：恢复、无障碍、响应式、自动化与清理。

## 17. 完成标准

- 163 个 `FC-*` 被选中的每一条均记录 PASS/FAIL/BLOCKED/NOT RUN。
- P0 必须为 0：跨租户访问、未 Ready 完成、支付阻断绕过、重复收款、错误找零、整桌半提交、重复/超额冲正均为发布阻断。
- 页面、Payment、Order status、Table Session、审计、SignalR 和收据最终一致。
- 连接成功不能代替实体打印 PASS；未观察物理票不得标 PASS。
- 本包通过不代表厨房制作、Stripe 在线资金或完整 release/full 验收通过。
