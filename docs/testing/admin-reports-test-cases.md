# DineFlow Admin Reports 专项测试用例

测试包名称：`admin-reports`  
稳定用例前缀：`RPT-*`  
页面：`/admin/reports`  
用例总数：160  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-reports`、指定 `RPT-*` 或 `full` 时才执行。

本包覆盖 Activity、Audit、Orders、Payments 四个视图，业务摘要、技术证据、搜索筛选、时间与币种、CSV、保留政策、权限与租户隔离。**可读性是本包的核心验收项**：不仅检查“有数据”，还要验证餐厅经营者能否快速理解人物、动作、对象、结果、金额和时间，技术 JSON 不得压过业务信息。

相邻测试包：支付/退款资金状态见 [admin-payments-test-cases.md](admin-payments-test-cases.md)；订单流转见 [admin-orders-test-cases.md](admin-orders-test-cases.md)；隐私请求和整站合规见 `privacy-legal`；Dashboard 指标见 [dashboard-test-cases.md](dashboard-test-cases.md)。

## 1. 执行和证据规则

- 本专项以只读为主。不要为了制造报表而发送真实邮件、真实退款、真实付款或生产 webhook。
- 可在 Local/Test 使用一次性订单、付款、退款和审计夹具；运行结束必须恢复，并核对日志表没有被测试代码更新或删除。
- 截图避免完整邮箱、IP、User-Agent、Correlation ID、Stripe ID、访问 Token 和原始技术 JSON；需要证明字段存在时使用打码值。
- PlatformOwner 与 Restaurant Owner/Admin 必须分别测试，因为原始 JSON、IP 和网络标识的可见范围不同。
- 可读性截图至少覆盖：桌面默认页、最拥挤的多币种摘要、最长活动卡、最长技术表格行、移动端卡片、深色主题和 200% 缩放。
- 每条已选择用例记录 `PASS`、`FAIL`、`BLOCKED` 或 `NOT RUN`；没有真实观察不得标 PASS。

## 2. 推荐夹具

| 夹具 | 最低要求 |
|---|---|
| 角色 | PlatformOwner；餐厅 A/B 各 Owner/Admin；Staff；Customer；Guest；无餐厅 Admin |
| 餐厅 | A/B 不同时区；长名称餐厅；AUD + 至少一种非 AUD |
| Activity | User、Customer、Automation、Provider、System；Success/Warning/Error；8 个业务分类 |
| Audit | 短/长 Summary；before/after JSON；无 actor；Unicode；超长 email/entity/action |
| Order events | 完整状态链、退款事件、长 message、缺失 actor、重复时间戳 |
| Payment events | success/failure/refund/dispute；多 provider；金额/币种；缺失 order/status/provider event |
| 时间 | 今天、跨午夜、Adelaide DST 切换日、旧记录、未来异常时间 |
| 大数据 | 0、1、19、20、21、100、101、5,000、5,001 和 10k+ 行 |
| 外部能力 | 可控浏览器 viewport/zoom/theme；CSV 下载读取；可选屏幕阅读器 |

## 3. 前置检查（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-PRE-01 | P0 | 目标环境 | 记录 URL、Local/Test/Staging/Production、分支、提交、时区和端点 | 环境明确；Production 默认只读 | Auto |
| RPT-PRE-02 | P1 | 工作区 | 记录 dirty、Node/.NET/容器版本 | 不覆盖用户改动；命令可复现 | Auto |
| RPT-PRE-03 | P0 | 角色账号 | 解析 PlatformOwner、A/B Owner/Admin、Staff、Customer、无餐厅 Admin | userId/role/restaurantId 对应明确 | Auto |
| RPT-PRE-04 | P0 | 数据库 | 记录 AuditLog、OrderEventLog、PaymentEventLog 行数及时间范围 | 可对账；不导出不必要敏感数据 | Auto |
| RPT-PRE-05 | P1 | 报表政策 | 调 `GET /api/admin/reports/policy` | 5000 行上限、保留天数、immutable 与敏感权限均明确 | Auto |
| RPT-PRE-06 | P1 | 可读性环境 | 确认桌面、390/768 viewport、缩放、浅/深色主题 | 缺少的尺寸提前标 NOT RUN | Auto |
| RPT-PRE-07 | P1 | CSV | 确认可读取浏览器下载且使用隔离目录 | 可检查内容并在测试后清理 | Auto |
| RPT-PRE-08 | P0 | 一次性数据 | 为长文本、多币种、DST、公式字符准备可追踪夹具 | 不污染生产证据；结束可精确清理 | Auto |

## 4. 页面、标签、URL 与加载（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-PAGE-01 | P1 | 正常网络 | 打开 `/admin/reports` | 唯一 H1 Reports；默认 Activity；摘要、筛选和内容完成加载 | Auto |
| RPT-PAGE-02 | P1 | 四标签 | 依次切 Activity/Audit/Orders/Payments | 每次只显示对应内容、表头、摘要和筛选语义 | Auto |
| RPT-PAGE-03 | P1 | 合法深链 | 使用 section/q/restaurant/type/category/actor/outcome/from/to/page/pageSize 打开并刷新 | URL 与控件、页码、内容一致，无别店数据闪现 | Auto |
| RPT-PAGE-04 | P1 | 非法深链 | 传非法 section、GUID、日期、page、pageSize、筛选枚举 | 安全回落或短 400；无空白页、NaN、500 | Auto |
| RPT-PAGE-05 | P1 | 浏览历史 | 切标签、筛选、翻页后前进/后退 | 页面和 URL 恢复一致；无旧标签覆盖 | Auto |
| RPT-PAGE-06 | P1 | Loading | 慢化四类列表和 policy/restaurants API | 旧数据不伪装成新筛选结果；Loading 文案稳定 | Auto |
| RPT-PAGE-07 | P1 | 空数据 | 四标签各返回 0 条 | 专用空态清楚；不显示 Page 0 of 0 或 0/0 异常模型 | Auto |
| RPT-PAGE-08 | P1 | 列表失败 | 分别让 activity/audit/orders/payments 失败 | 持久错误区含 Retry；不显示服务器堆栈或 secret | Auto |
| RPT-PAGE-09 | P1 | 支持 API 失败 | policy 或 restaurants 失败、列表成功 | 可用内容保留；缺失信息明确，不用假值冒充 | Auto |
| RPT-PAGE-10 | P1 | Retry | 恢复 API 后点击 Retry | 错误清除；列表、摘要、范围同步恢复 | Auto |
| RPT-PAGE-11 | P1 | Refresh | 快速双击 Refresh、加载中再次点击 | 按钮禁用；无重复请求或乱序覆盖 | Auto |
| RPT-PAGE-12 | P1 | 快速切换 | 慢请求中 Activity→Payments→Audit | 已取消响应不覆盖当前标签；不弹 Abort toast | Auto |

## 5. 路由、角色、租户与隐私（12）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-ROLE-01 | P1 | Guest | 直接打开页面和刷新 | 跳转登录；无活动、邮箱、金额闪现 | Auto |
| RPT-ROLE-02 | P0 | Customer | 打开页面并调全部 report API/export | 页面拒绝；API 403 | Auto |
| RPT-ROLE-03 | P0 | Staff | 打开页面并调全部 report API/export | 页面拒绝；API 403 | Auto |
| RPT-ROLE-04 | P0 | Owner/Admin A | 打开四标签和摘要 | 只显示餐厅 A；无餐厅筛选越权扩展 | Auto |
| RPT-ROLE-05 | P0 | Admin A + restaurant B | URL/API 传 restaurantId=B 并导出 | 403 或收窄 A；绝不返回 B 行数和存在性 | Auto |
| RPT-ROLE-06 | P1 | PlatformOwner | All restaurants 与 A/B 之间切换 | 四标签、摘要、CSV 同时按范围变化 | Auto |
| RPT-ROLE-07 | P0 | 无餐厅 Admin | 页面/API/export | 403 且提示未分配；不降级全平台 | Auto |
| RPT-ROLE-08 | P0 | 非平台角色 | 查看 Activity technical details、Audit/Order/Payment JSON | 原始 JSON、IP、User-Agent、Correlation/network 标识被移除或最小化 | Auto |
| RPT-ROLE-09 | P0 | PlatformOwner | 查看相同记录 | 需要调查的技术字段可用但默认折叠，不进入普通截图 | Auto |
| RPT-ROLE-10 | P0 | A/B 相同 ID 片段 | 搜索、深链、订单跳转 | 不因短 ID 或订单号相似泄露另一租户 | Auto |
| RPT-ROLE-11 | P1 | 同浏览器切账号 | PlatformOwner→Admin A→Admin B→Customer | 缓存、筛选、展开 JSON、导出范围完全重置 | Assisted |
| RPT-ROLE-12 | P1 | 被禁用用户 | 保留旧页面并刷新/导出 | 权限立即按会话策略撤销；文件不下载 | Auto |

## 6. 核心可读性与视觉层级（24）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-READ-01 | P1 | 首屏 | 不滚动观察标题、说明、标签、摘要、搜索和动作 | 视觉顺序清楚；Export/Refresh 不抢过主标题 | Assisted |
| RPT-READ-02 | P1 | 信息层级 | 比较标题、actor/action、辅助 ID、时间、技术内容字号/颜色 | 业务结论最突出；辅助与技术信息逐级弱化但仍可读 | Assisted |
| RPT-READ-03 | P1 | 摘要六项 | Activity 显示六个指标 | 网格平衡，不出现孤立窄卡、遮挡或含义不清的第二行 | Assisted |
| RPT-READ-04 | P0 | 多币种摘要 | 同时显示 AUD/NPR/INR 付款和退款 | 每币种独立并带币种；不相加、不截掉关键金额 | Auto |
| RPT-READ-05 | P1 | 长摘要金额 | 构造大金额、多币种串 | 完整值可读或提供可访问展开/title；不能只剩省略号 | Assisted |
| RPT-READ-06 | P1 | 摘要范围 | 同时观察 Today 指标、visible/matches 和筛选 | “今天/时区/当前筛选/全部匹配”范围不会被误认为同一口径 | Assisted |
| RPT-READ-07 | P1 | 折叠摘要 | 展开/折叠并切标签 | 箭头方向、aria-expanded 和内容状态一致；折叠后不留大空白 | Auto |
| RPT-READ-08 | P1 | 活动卡扫描 | 连续查看 20 条不同类别活动 | 3–5 秒可识别谁、做了什么、对象、结果、时间 | Assisted |
| RPT-READ-09 | P1 | 严重程度 | Success/Warning/Error 相邻显示 | 除颜色外有文字/徽标；错误显著但不吞没内容 | Assisted |
| RPT-READ-10 | P1 | 长人物与餐厅名 | 使用 80 字符姓名/邮箱/餐厅名 | 换行或安全截断；不覆盖时间、金额和操作 | Auto |
| RPT-READ-11 | P1 | Unicode | 中文、emoji、重音字符、RTL 片段进入描述 | 不乱码、不破坏行高或布局；CSV 保持 UTF-8 | Auto |
| RPT-READ-12 | P1 | 长订单/事件名 | 超长 order number/action/event/provider/status | 徽标和链接不撑破容器；关键差异仍可辨认 | Auto |
| RPT-READ-13 | P1 | 时间表达 | 同一事件在列表、title、订单页比较 | 使用 en-AU 可读格式；时区含义可发现且一致 | Auto |
| RPT-READ-14 | P1 | 相对优先级 | 一条记录同时含金额、状态、来源、角色、餐厅、订单链接 | 不形成徽标噪声；金额/失败状态/订单链接容易找到 | Assisted |
| RPT-READ-15 | P1 | 文本长度 | 79/80/81 字符 Summary/Message | 展开按钮阈值稳定；不因一个字符跳动错位 | Auto |
| RPT-READ-16 | P1 | 展开长文 | Show more/less 多次 | 展开后全文换行；收起恢复；相邻行不覆盖 | Auto |
| RPT-READ-17 | P1 | JSON 默认状态 | 打开技术标签 | JSON 默认高度有限且折叠，业务 Summary/Message 优先 | Auto |
| RPT-READ-18 | P1 | JSON 展开 | 展开 5KB 深层 JSON | 等宽、缩进、换行和局部滚动清楚；页面不横向溢出 | Assisted |
| RPT-READ-19 | P1 | 无数据字段 | actor/order/status/message/JSON 分别为空 | 使用一致的人类化占位，不出现 null/undefined/空徽标 | Auto |
| RPT-READ-20 | P1 | 表格密度 | 20 行技术记录 | 行高可扫描；列边界、主次文本和时间对齐清楚 | Assisted |
| RPT-READ-21 | P1 | 横向表格 | 桌面查看最宽 Payments 表 | 顶部/底部横向滚动可发现；页面本身不横向溢出 | Assisted |
| RPT-READ-22 | P1 | 浅色/深色 | 四标签分别切换主题 | 正文、muted、边框、徽标、链接和 JSON 对比度足够 | Assisted |
| RPT-READ-23 | P1 | 80–200% 缩放 | 在 80/100/125/150/200% 查看核心内容 | 无重叠/裁切；重要值不只靠 hover 才能读 | Assisted |
| RPT-READ-24 | P1 | 空/错/加载状态 | 并排检查三种状态 | 文案彼此明显不同；错误可操作、空态可清筛选、加载不似 0 数据 | Assisted |

## 7. Business Activity 内容（12）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-ACT-01 | P1 | 人工操作 | 查看 User actor 的订单/菜单/餐厅/用户事件 | 使用人物名和业务动词，不要求读 event code | Auto |
| RPT-ACT-02 | P1 | Customer | 查看顾客下单/退款请求活动 | 明确 Customer 身份；避免显示不必要联系方式 | Auto |
| RPT-ACT-03 | P1 | Automation | 查看自动接单/恢复事件 | 显示 DineFlow automation，不伪装成人工员工 | Auto |
| RPT-ACT-04 | P1 | Provider | 查看 Stripe/payment provider 事件 | 来源与状态清楚；不把 provider 当餐厅员工 | Auto |
| RPT-ACT-05 | P1 | System/unknown | 缺少 actor 信息 | 使用 System/DineFlow/Unknown actor 的一致降级 | Auto |
| RPT-ACT-06 | P0 | 金额 | 对照支付/退款事件和 DB cents | 金额、币种、正负语义准确；退款不显示为收入 | Auto |
| RPT-ACT-07 | P1 | 订单链接 | 点击 Activity 的 Order 链接并返回 | 打开正确租户订单筛选；返回后位置/筛选可恢复 | Auto |
| RPT-ACT-08 | P1 | 时间顺序 | 相同时间戳和跨来源事件 | occurredAt 倒序稳定；刷新不随机换位 | Auto |
| RPT-ACT-09 | P1 | 类别与动作 | 遍历 8 类和常见 actionLabel | 类别、图标、动作名和实际事件一致 | Auto |
| RPT-ACT-10 | P1 | Outcome | Success/Warning/Failed 数据 | severity 与状态/描述一致，不把 Pending 当成功 | Auto |
| RPT-ACT-11 | P0 | 技术数据最小化 | Admin A 查看 Activity | 无 technicalJson/correlation/network 原文；业务信息仍足够 | Auto |
| RPT-ACT-12 | P1 | 去重 | 同一底层动作产生 audit/order/payment 记录 | Feed 按定义不造成误导性三次业务动作；重复来源可解释 | Auto |

## 8. Audit、Order 与 Payment 技术表（14）

| ID | 优先级 | 视图/场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-TECH-01 | P1 | Audit | 核对 Action/Actor/Entity/Summary/Change/Time | 各列含义明确，主副文本不串列 | Auto |
| RPT-TECH-02 | P1 | Orders | 核对 Event/Order/Actor/Message/Data/Time | 事件链可按订单读懂，订单链接正确 | Auto |
| RPT-TECH-03 | P1 | Payments | 核对 Event/Order/Payment/Actor/Status/Message/Data/Time | provider、内部付款、事件和状态不会混淆 | Auto |
| RPT-TECH-04 | P1 | ID | 长 entity/order/payment/providerEvent ID | 紧凑显示不碰撞；不同 ID 类型有上下文 | Auto |
| RPT-TECH-05 | P1 | Source | DineFlow/Stripe/Counter/Automation 来源 | 来源值准确且位置一致 | Auto |
| RPT-TECH-06 | P1 | Audit change | beforeJson、afterJson、两者均有/均空 | 按产品定义展示正确版本；不误称完整 diff | Auto |
| RPT-TECH-07 | P1 | JSON | 合法 JSON、数组、scalar、非 JSON 文本 | 合法内容美化；非 JSON 原文安全显示；不崩溃 | Auto |
| RPT-TECH-08 | P0 | JSON XSS | JSON/Message 含 HTML、script、事件属性 | 只作为文本显示；无执行、链接注入或 DOM 破坏 | Auto |
| RPT-TECH-09 | P1 | 缺字段 | 三类日志缺 actor/source/status/order/provider event | 一致降级；不出现误导性 “Paid” 或 “DineFlow” | Auto |
| RPT-TECH-10 | P1 | 时间线 | 同一订单完整状态链 | 时间、actor、message 连贯；无重复/缺失关键转换 | Auto |
| RPT-TECH-11 | P0 | 付款状态单向 | Paid/Partial/Refunded 后出现旧 Pending 事件 | 报表保留事件事实但不把当前状态错误展示为回退 | Auto |
| RPT-TECH-12 | P1 | 移动卡片 | 在 390px 查看三类技术记录 | 保留定位调查所需的事件、对象、时间、状态和展开内容 | Assisted |
| RPT-TECH-13 | P1 | 桌面/移动一致 | 同一记录对比表格和卡片 | 值、时间、权限和链接一致，不因布局丢字段 | Auto |
| RPT-TECH-14 | P0 | 原始敏感值 | 搜索 JSON、IP、User-Agent、provider payload | 仅 PlatformOwner 可见；导出遵守相同边界 | Auto |

## 9. 搜索、筛选、日期、URL 与分页（18）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-FILTER-01 | P1 | Activity search | 搜人物、订单、付款、动作、餐厅 | 所声明字段命中；大小写和前后空格不影响 | Auto |
| RPT-FILTER-02 | P1 | Technical search | 分别搜 event、order、actor、provider、message、ID | 三标签语义与后端一致 | Auto |
| RPT-FILTER-03 | P1 | 特殊字符 | 搜 `%`、`_`、反斜杠、引号、emoji、SQL 片段 | 按字面安全搜索；无通配放大/注入/500 | Auto |
| RPT-FILTER-04 | P1 | 长度边界 | 输入 200/201/1000 字符并快速修改 | 合法上限可控；超限就地拒绝或短 400 | Auto |
| RPT-FILTER-05 | P1 | debounce | 快速键入并清空搜索 | 最后值获胜；旧 300ms 请求不覆盖 | Auto |
| RPT-FILTER-06 | P1 | Category | 遍历 8 类 | 只返回对应业务类别，计数正确 | Auto |
| RPT-FILTER-07 | P1 | Who | 遍历 User/Customer/Automation/Provider/System | actor 分类正确，无漏/混 | Auto |
| RPT-FILTER-08 | P1 | Outcome | Successful/Warnings/Failed | 与 severity/状态定义一致 | Auto |
| RPT-FILTER-09 | P1 | Action/Event type | Audit/Orders/Payments 输入完整和部分值 | 匹配规则清楚；切标签旧 type 不误用 | Auto |
| RPT-FILTER-10 | P0 | Restaurant | PlatformOwner 选 A/B/All | 列表、summary、matches、CSV 同范围 | Auto |
| RPT-FILTER-11 | P1 | From date | 选餐厅本地某日 | 从本地 00:00 开始；UTC 转换正确 | Auto |
| RPT-FILTER-12 | P1 | Through date | 选结束日 | 包含本地整日最后毫秒，不漏午夜边界 | Auto |
| RPT-FILTER-13 | P1 | DST | Adelaide 夏令时开始/结束日 | 不按固定偏移算 24 小时；无重复/漏项 | Assisted |
| RPT-FILTER-14 | P1 | 非法日期 | from>to、无效日期、未来范围 | UI 阻止或 API 短 400；不显示旧数据冒充空结果 | Auto |
| RPT-FILTER-15 | P1 | Chips | 添加多个筛选，逐个移除和 Clear all | 标签可读、长值不溢出；URL/结果同步 | Auto |
| RPT-FILTER-16 | P1 | 组合 | 搜索+餐厅+类别/type+日期 | 取交集；无跨标签残留 | Auto |
| RPT-FILTER-17 | P1 | 分页 | 20/50/100，首/中/末/越界页 | 无重复漏项；范围、Page、TotalItems 一致 | Auto |
| RPT-FILTER-18 | P1 | 竞态 | 连续筛选、翻页、切标签和 Refresh | 最后条件获胜；旧响应被取消 | Auto |

## 10. 摘要、金额、时间与数据准确性（12）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-SUM-01 | P0 | Activity today | 按摘要时区对照三类底层日志 | 活动数定义准确，排除约定的重复/噪声事件 | Auto |
| RPT-SUM-02 | P0 | Completed orders | 对照 distinct order 状态事件 | 同一订单不重复计数；只计当天 Completed | Auto |
| RPT-SUM-03 | P0 | Payments received | 对照 Payments.PaidAt 与 AmountCents | 按币种分组、cents 精确；不把柜台/Stripe语义混错 | Auto |
| RPT-SUM-04 | P0 | Refunded | 对照 succeeded refunds/RefundedAt | 只计成功退款；按币种分组；Pending/Failed 不计 | Auto |
| RPT-SUM-05 | P1 | Failed payments | 对照 FailedAt 当地日 | 计数、时区边界和重复 attempt 定义一致 | Auto |
| RPT-SUM-06 | P0 | Paid awaiting acceptance | 构造昨天/今天已付 Pending 订单 | 指标是当前未接单库存，不错误限定今天 | Auto |
| RPT-SUM-07 | P1 | Overdue/longest | 构造阈值前后和最长等待 | overdue 数与 tooltip 分钟准确，无负数 | Auto |
| RPT-SUM-08 | P1 | 餐厅时区 | A/B/All 切换 | 单店用餐厅时区；All 的 UTC/平台规则明确可见 | Auto |
| RPT-SUM-09 | P1 | 技术标签摘要 | Audit/Orders/Payments | Current view、Total matches、Retention、Integrity 与实际一致 | Auto |
| RPT-SUM-10 | P0 | 保留天数 | 对照 policy 和文档 | Audit/Payment 2555 天、Order 730 天；不混用 | Auto |
| RPT-SUM-11 | P1 | visible/matches | 20/50/100 页和空页 | visible 是当前页实际行数，matches 是完整筛选总数 | Auto |
| RPT-SUM-12 | P1 | null/0/极大值 | 无金额、0、负异常、极大 cents、未知币种 | 无 NaN/Infinity；异常可诊断，不静默错误格式化 | Auto |

## 11. 展开内容、链接和调查路径（8）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-DETAIL-01 | P1 | Show more | 展开/收起长 Summary/Message | 文字完整、按钮名称变化、焦点不丢 | Auto |
| RPT-DETAIL-02 | P1 | Technical details | 展开 Activity details | JSON 与 correlation 分区清楚；默认不进入读屏主流程 | Assisted |
| RPT-DETAIL-03 | P1 | JsonSnippet | 连续展开多行后翻页/切标签 | 状态不会串到另一记录；新数据默认折叠 | Auto |
| RPT-DETAIL-04 | P1 | 订单链接 | 从 Activity/Orders/Payments 打开订单 | 编码安全，指向正确订单与租户 | Auto |
| RPT-DETAIL-05 | P1 | 返回路径 | 从订单页返回 Reports | 标签、筛选、页码和滚动位置尽量恢复 | Assisted |
| RPT-DETAIL-06 | P0 | correlation | 使用 correlation 串联 audit/order/payment | PlatformOwner 可完成调查；非平台不可见敏感原值 | Auto |
| RPT-DETAIL-07 | P1 | 不存在对象 | 日志指向已删除/归档订单或用户 | 报表证据仍可读；链接安全 404，不破坏页面 | Auto |
| RPT-DETAIL-08 | P1 | 新标签/复制 | 对调查值进行浏览器复制或打开关联页 | 不截取错误 ID；无 opener 风险；无敏感 toast | Assisted |

## 12. CSV、保留、不可变性与合规（14）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-EXP-01 | P1 | 四标签 | 分别 Export CSV | 文件名/表头/行类型对应当前标签；UTF-8 可读 | Auto |
| RPT-EXP-02 | P0 | 当前筛选 | 餐厅、搜索、类型、日期组合后导出 | 导出完整匹配集，不只当前页、不含别店 | Auto |
| RPT-EXP-03 | P1 | 公式注入 | 字段以 `= + - @`、tab/newline/引号开头 | Excel/Sheets 不执行公式；内容仍可识别 | Auto |
| RPT-EXP-04 | P1 | Unicode/长文本 | 导出中文、emoji、换行、逗号、双引号 | 行列不破坏；Excel 和文本解析一致 | Auto |
| RPT-EXP-05 | P0 | 金额 | 对照页面、DB、CSV AmountCents/Currency | cents 与币种清楚；不受 locale 小数影响 | Auto |
| RPT-EXP-06 | P1 | 时间 | 对照 OccurredAt/CreatedAt | CSV 明确 ISO/UTC 约定；不把本地显示时间冒充 UTC | Auto |
| RPT-EXP-07 | P1 | 5000 行 | 恰好 5000 | 完整导出；header row 不计入上限 | Auto |
| RPT-EXP-08 | P0 | 5001+ 行 | 导出 | 仅前 5000 且 response headers/UI 明确 warning 与再次缩窄方法 | Auto |
| RPT-EXP-09 | P0 | 租户/技术字段 | PlatformOwner 与 Admin A 导出相同范围 | A 只有本店且无受限 JSON/IP；平台文件含授权调查字段 | Auto |
| RPT-EXP-10 | P1 | 失败 | 第 N 批 DB/API 失败或下载被阻止 | 不产生看似完整的部分文件；短错误可重试 | Auto |
| RPT-EXP-11 | P1 | 双击/切标签 | 导出中重复点击或切视图 | 按钮禁用；只下载一个启动时视图文件 | Auto |
| RPT-EXP-12 | P1 | 隐私最小化 | 检查所有 CSV 列 | 只含业务/调查所需字段，无 token/password/secret/多余 PII | Assisted |
| RPT-EXP-13 | P0 | 不可变性 | 尝试经 EF/runtime role 更新/删除日志行 | 应用和 DB trigger 拒绝；报告 API 无写端点 | Auto |
| RPT-EXP-14 | P1 | 保留说明 | 对照 UI、policy、文档、定时任务/归档配置 | 期限一致；UI 不把“已声明”误称“已执行”；legal hold 可审计 | Manual |

## 13. 无障碍、响应式、主题与缩放（16）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-A11Y-01 | P1 | 标题/区域 | 检查 H1、tabs、summary、feed、tables、alerts | 唯一 H1；区域名称和层级可理解 | Auto |
| RPT-A11Y-02 | P1 | 键盘标签 | 仅键盘切四标签 | Arrow/Home/End/Tab 行为正确，选中状态可读 | Assisted |
| RPT-A11Y-03 | P1 | 键盘筛选 | 打开 filter popover、选择、清除、关闭 | 无陷阱；Escape 关闭；焦点返回触发器 | Assisted |
| RPT-A11Y-04 | P1 | 摘要键盘 | 聚焦 toggle 并 Enter/Space | 展开状态和 aria-expanded 同步 | Auto |
| RPT-A11Y-05 | P1 | 展开按钮 | Show more/Technical details 用键盘操作 | 名称明确；展开后焦点和读序稳定 | Assisted |
| RPT-A11Y-06 | P1 | 表格 | 屏幕阅读器读取 captions、headers、cells | Audit/Orders/Payments 表意明确，不靠视觉位置猜列 | Assisted |
| RPT-A11Y-07 | P1 | Activity feed | 读屏读取列表项 | actor→动作→结果→上下文→时间顺序合理 | Assisted |
| RPT-A11Y-08 | P1 | 状态/错误 | Success/Warning/Error/Loading/Empty | 不只靠颜色；动态状态能被发现但不重复轰炸 | Assisted |
| RPT-A11Y-09 | P1 | 对比度 | 浅/深色检查正文、muted、链接、徽标、边框 | 文本和非文本对比达到适用 WCAG AA | Assisted |
| RPT-A11Y-10 | P1 | 焦点 | 全页 Tab 顺序及焦点环 | 顺序符合视觉流程；所有控件焦点清晰 | Assisted |
| RPT-A11Y-11 | P1 | 320/390 | 四标签、摘要、筛选、分页、移动卡片 | 无页面横向溢出；关键字段和按钮可触达 | Assisted |
| RPT-A11Y-12 | P1 | 768 | 平板纵/横向 | 不出现桌面表格与移动卡片重复；布局利用空间合理 | Assisted |
| RPT-A11Y-13 | P1 | 桌面 | 1280/1440/1920 | 内容不过度拉宽；时间、长列和操作保持可扫读 | Assisted |
| RPT-A11Y-14 | P1 | 200% zoom | 1280 宽放大到 200% | 等价窄屏可用；无内容裁切和双层横滚陷阱 | Assisted |
| RPT-A11Y-15 | P1 | 触控 | 在移动设备操作 chips、tabs、filter、pagination | 目标尺寸足够；不误触相邻操作 | Assisted |
| RPT-A11Y-16 | P1 | 减少动画/高对比 | prefers-reduced-motion、系统高对比 | 功能不依赖动画；边界、选中、错误仍可辨认 | Assisted |

## 14. 可靠性、性能、并发与清理（10）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| RPT-REC-01 | P1 | 10k+ 数据 | 打开四标签、筛选和翻页 | 服务端分页；首屏与交互在目标时间；浏览器不全量排序 | Auto |
| RPT-REC-02 | P1 | 长 JSON | 一页 100 条且每条 5KB | 默认折叠不卡顿；展开单条不重排整页失控 | Auto |
| RPT-REC-03 | P1 | 断网恢复 | 加载、刷新、导出前后断网 | 不显示伪成功/伪空；恢复后 Retry 安全 | Assisted |
| RPT-REC-04 | P1 | 429/502/timeout | 四 API 与 export 注入错误 | 短提示无堆栈；按钮恢复；可重试 | Auto |
| RPT-REC-05 | P1 | 多标签 | 两浏览器标签使用不同餐厅/筛选 | URL 状态隔离；无共享组件缓存串值 | Auto |
| RPT-REC-06 | P1 | 新日志并发 | 浏览第一页时持续写入新事件并翻页 | 稳定排序；允许新数据提示，但不随机重复/漏旧行 | Assisted |
| RPT-REC-07 | P0 | append-only 并发 | 业务事务与日志写入成功/回滚 | 成功动作有对应证据；失败事务不留下虚假成功日志 | Auto |
| RPT-REC-08 | P1 | 非法/损坏记录 | 无效时区、币种、JSON、极长字段 | 页面安全降级；单条坏数据不使整页 500 | Auto |
| RPT-REC-09 | P1 | 浏览器缓存 | 登出、后退、重新登录另一角色 | 不显示旧报表或已展开的敏感 JSON | Assisted |
| RPT-REC-10 | P0 | 收尾 | 对照日志基线、下载目录和一次性夹具 | 无日志更新/删除；测试文件清理；证据脱敏 | Auto |

## 15. 推荐执行顺序

1. `RPT-PRE-*`、`RPT-ROLE-*`：先锁定环境、权限、租户和技术字段边界。
2. `RPT-PAGE-*`、`RPT-READ-*`、`RPT-ACT-*`、`RPT-TECH-*`：完成只读内容与可读性截图。
3. `RPT-FILTER-*`、`RPT-SUM-*`、`RPT-DETAIL-*`：对照 URL、API 与数据库。
4. `RPT-EXP-*`：使用隔离下载目录检查 CSV 和保留政策。
5. `RPT-A11Y-*`、`RPT-REC-*`：设备、读屏、性能、故障恢复和最终清理。

## 16. 未来执行时的用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| 真机可读性 | 在手机 Safari/Chrome 和平板打开四标签 | 核对截图、溢出、触控和移动卡信息完整性 |
| 屏幕阅读器 | 使用 VoiceOver/NVDA 完成 tabs、filter、feed、table | 记录读序、名称、状态与焦点问题 |
| 生产保留 | 提供归档任务、对象存储、legal hold 和恢复演练证据 | 核对政策不是仅文档声明 |
| 真实大数据 | 在隔离 staging 准备 5,001/10k+ 日志 | 验证截断、性能和分页稳定性 |

## 17. 完成标准

- 160 条被选用例都有真实状态；P0 任一失败即阻止 Reports 专项通过。
- PlatformOwner、Owner/Admin A/B、Staff/Customer/Guest 和无餐厅账号权限均有页面与 API 证据。
- 业务人员能在不展开 JSON 的情况下理解谁、做了什么、对象、结果、金额和时间。
- 多币种、时区、今天/当前状态/当前筛选的口径清楚且与 DB 一致。
- 技术证据默认折叠、可调查、不可变，并严格遵守租户和敏感字段权限。
- CSV 防公式注入、按筛选导出、5000 行截断明确，且没有多余 PII/secret。
- 320/390/768/桌面、浅/深色、200% zoom 和关键读屏路径没有阻塞性可读性问题。
- 本专项通过不代表付款、退款、打印、备份恢复或整站发布验收完成。
