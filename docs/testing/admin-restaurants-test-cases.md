# DineFlow Admin Restaurants 专项测试用例

测试包名称：`admin-restaurants`  
稳定用例前缀：`REST-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-restaurants`、某个 `REST-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/admin/restaurants` 的四个分区：**Restaurants 目录与增删改**（基本信息、澳洲合规字段、支付设置、Stripe Connect、平台服务费）、**Hours**（每周营业时间）、**Calendar**（特殊日期）、**Tables**（桌台与二维码）。

相邻测试包，不要在本包内重复覆盖：
- Dashboard 上的营业状态徽章、暂停控件与 Watched items → [dashboard-test-cases.md](dashboard-test-cases.md)
- 用户目录、角色与账号状态 → [admin-users-test-cases.md](admin-users-test-cases.md)
- 顾客下单、支付与退款全流程 → [full-system-test-cases.md](full-system-test-cases.md)

## 1. 执行与安全规则

- **只在 Local/Test/Staging 执行写操作。** 本包会改变营业时间、接单状态、支付设置和桌台二维码，这些直接决定顾客能不能下单，Production 默认只读。
- **Stripe 相关用例只允许在测试模式下执行。** 绝不能对已接真钱的 Connect 账号发起 onboarding、刷新或平台服务费结账。
- 测试前记录并在结束时恢复：`isActive`、`acceptingOrders`、`acceptingOrdersPausedUntil`、`openingHoursJson`、`specialOpeningDaysJson`、`currency`、`timezone`、合规字段全部、支付设置、以及所有桌台的编号与 `isActive`。
- **删除餐厅默认使用一次性餐厅**，且必须是没有订单、没有菜品、没有员工归属的空壳；不得删除夹具餐厅。
- 二维码用例只允许指向本地或测试前端；**不得把生产桌码写入报告或截图**。
- 越权用例必须使用 A/B 两个真实餐厅，并**直接调用 API 复核**，不能只看前端有没有隐藏入口。
- 本文件只定义用例；增加或修改用例不会自动开始浏览器操作。

## 2. 角色与端点授权（先读这一节）

`RestaurantController` 整体是 `AdminApi` 策略，**三个端点额外收紧到 PlatformOwnerOnly**。这三个是本包越权用例的重点：

| 端点 | 授权 | 说明 |
|---|---|---|
| `GET /api/restaurant` | AdminApi | 目录；非平台主只应看到自己的餐厅 |
| `GET /api/restaurant/{id}` | AdminApi + 归属校验 | |
| **`POST /api/restaurant`** | **PlatformOwnerOnly** | 建店 |
| `PUT /api/restaurant/{id}` | AdminApi + 归属校验 | 改基本信息与合规字段 |
| **`DELETE /api/restaurant/{id}`** | **PlatformOwnerOnly** | 删店 |
| `PATCH /api/restaurant/{id}/ordering-status` | AdminApi + 归属 | 暂停/恢复接单 |
| `PUT /api/restaurant/{id}/opening-hours` | AdminApi + 归属 | **带乐观并发** |
| `PUT /api/restaurant/{id}/special-days` | AdminApi + 归属 | **带乐观并发** |
| `GET /api/restaurant/{id}/payment-settings` | AdminApi + 归属 | |
| **`PATCH /api/restaurant/{id}/payment-settings`** | **PlatformOwnerOnly** | 平台服务费率 |
| `POST /api/restaurant/{id}/stripe/connect-link` | AdminApi + 归属 | |
| `POST /api/restaurant/{id}/stripe/refresh` | AdminApi + 归属 | |
| `GET /api/restaurant/{id}/stripe/business-profile-import` | AdminApi + 归属 | 从 Stripe 拉取身份信息 |
| `POST /api/restaurant/{id}/stripe/diagnostics` | AdminApi + 归属 | |
| `POST /api/restaurant/{id}/platform-fee/checkout` | AdminApi + 归属 | |
| `GET/POST /api/tables/restaurant/{restaurantId}` | AdminApi + 归属 | 列出/新建桌台 |
| `PUT /api/tables/{id}` | AdminApi + 归属 | 改桌台 |

**分区可见性按角色不同**：PlatformOwner 看到 `Restaurants / Hours / Calendar / Tables`；RestaurantOwner 与 Admin 没有 Restaurants 目录分区，首个分区是 `Tables`。

**桌台没有删除端点**——只能停用（`isActive=false`）。任何"删除桌台"的用例都应验证停用语义，而不是期待 DELETE。

## 3. 推荐夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| PlatformOwner | 唯一 | 建店、删店、平台费率、跨店 |
| RestaurantOwner A/B | 分属餐厅 A/B | 跨租户越权、营业配置 |
| Admin A/B | 分属餐厅 A/B | 主要操作者 |
| Staff A | 餐厅 A | 只读边界 |
| 餐厅 A/B | 明确不同，A 有订单/菜品/桌台 | 隔离与删除保护 |
| 一次性空壳餐厅 | 每轮新建，无订单无菜品 | 删除用例 |
| 多币种餐厅 | AUD + 至少一个非 AUD | 金额格式与平台费下限 |
| 合规完整餐厅 | ABN/GST/退款邮箱/附加费告知齐全 | 正例 |
| 合规缺失餐厅 | ABN 为空、GST 未登记 | 空值与降级展示 |
| Stripe 测试账号 | 测试模式 Connect，未完成与已完成各一 | onboarding、诊断、导入 |
| 排班夹具 | 24h、跨夜、多窗口、非本地时区 | Hours 与 Calendar |
| 桌台夹具 | 编号 1/2/10、active/inactive、带/不带 qrToken | 排序、唯一性、二维码 |
| 两个管理员会话 | 同店两标签 | 并发保存冲突 |

## 4. 前置检查（6）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-PRE-01 | P1 | 项目目录 | 记录分支、提交、环境与服务地址 | 明确不是误用生产环境 | Auto |
| REST-PRE-02 | P1 | 角色账号 | 解析各夹具的 UserId、角色、restaurantId | 归属明确；不记录密码 | Auto |
| REST-PRE-03 | P1 | 数据库 | 导出两个夹具餐厅的全部字段基线（含 JSON 排班） | 后置可精确核对与恢复 | Auto |
| REST-PRE-04 | P1 | Stripe | 确认为测试模式且密钥非生产 | 不对真实资金账号操作 | Auto |
| REST-PRE-05 | P1 | 桌台 | 导出所有桌台编号、isActive 与 qrToken 存在性 | 二维码变更可追溯；**不记录 token 明文** | Auto |
| REST-PRE-06 | P1 | 清理计划 | 定义每个写用例的恢复动作与责任人 | 每次写入都有对应清理 | Auto |

## 5. 路由、角色与租户隔离（16）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-ROLE-01 | P1 | 未登录 | 打开、刷新、后退 `/admin/restaurants` | 跳转登录；不闪现餐厅名、地址或桌码 | Auto |
| REST-ROLE-02 | P1 | Customer | 打开页面 | 明确无权限页面，不是 404 也不是空目录 | Auto |
| REST-ROLE-03 | P1 | Staff A | 打开页面并调用 `GET /api/restaurant` | 页面拒绝；API 403 | Auto |
| REST-ROLE-04 | P1 | Admin A | 打开页面 | **没有 Restaurants 目录分区**，首个分区是 Tables | Auto |
| REST-ROLE-05 | P1 | Admin A | 调用 `GET /api/restaurant` | 只返回餐厅 A；不含 B | Auto |
| REST-ROLE-06 | P0 | Admin A + 餐厅 B 的 id | `GET /{B}`、`PUT /{B}`、`PATCH /{B}/ordering-status` | 全部 403；不泄露 B 是否存在，且无写入 | Auto |
| REST-ROLE-07 | P0 | Admin A + 餐厅 B | `PUT /{B}/opening-hours`、`PUT /{B}/special-days` | 403；**B 的排班字节级不变** | Auto |
| REST-ROLE-08 | P0 | Admin A + 餐厅 B | 桌台 `GET/POST /api/tables/restaurant/{B}` | 403；不得列出或新建 B 的桌台 | Auto |
| REST-ROLE-09 | P0 | Admin A + B 的桌台 id | `PUT /api/tables/{B 的桌台}` | 403；跨店改桌号或停用都不允许 | Auto |
| REST-ROLE-10 | P0 | Admin A（非平台主） | `POST /api/restaurant` 建店 | 403；建店是平台主专属 | Auto |
| REST-ROLE-11 | P0 | Admin A / RestaurantOwner A | `DELETE /api/restaurant/{A}` 删自己的店 | 403；删店是平台主专属 | Auto |
| REST-ROLE-12 | P0 | Admin A / RestaurantOwner A | `PATCH /{A}/payment-settings` | 403；**餐厅不能自己改平台服务费率** | Auto |
| REST-ROLE-13 | P0 | Admin A + 餐厅 B | 所有 Stripe 端点（connect-link/refresh/import/diagnostics/platform-fee） | 全部 403；不得为别人的店发起 onboarding 或结账 | Auto |
| REST-ROLE-14 | P1 | 不存在/畸形 id | 对上述端点传随机 GUID、空串、`../`、SQL 片段 | 404/400；无堆栈、SQL 或内部路径 | Auto |
| REST-ROLE-15 | P1 | 同浏览器切账号 | Admin A → Admin B → PlatformOwner | 分区集合与数据按当前用户重算；不残留上个账号餐厅 | Auto |
| REST-ROLE-16 | P1 | 操作中被移出餐厅 | 保留页面后执行写操作 | 后端按当前归属拒绝；不依赖前端缓存 | Assisted |

## 6. 目录、搜索与分页（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-LIST-01 | P1 | PlatformOwner | 打开 Restaurants 分区 | 显示目录、总数与分页；唯一 H1 | Auto |
| REST-LIST-02 | P1 | 接口失败 | 让目录返回 500 | 可读错误并可重试；**不显示 0 家餐厅的空目录假象** | Auto |
| REST-LIST-03 | P1 | 选项接口失败 | 让辅助选项失败 | 顶部出现 role="alert" 的降级提示与 Try again | Auto |
| REST-LIST-04 | P1 | 搜索 | 搜店名、地址片段、大小写混合、前后空格 | 结果与后端一致；trim 后匹配 | Auto |
| REST-LIST-05 | P1 | 搜索通配符 | 搜 `%` 与 `_` | **按字面匹配**，不返回全部餐厅 | Auto |
| REST-LIST-06 | P2 | 搜索特殊字符 | `'`、中文、emoji、200 字符 | 不报错；结果可解释 | Auto |
| REST-LIST-07 | P1 | 分页 | 切页与页容量、深链、越界页码 | 状态还原；越界自动钳制 | Auto |
| REST-LIST-08 | P1 | 状态展示 | 对照数据库核对 active/inactive、接单/暂停徽章 | **暂停到期后显示"接单中"**，不读原始列 | Auto |
| REST-LIST-09 | P1 | 多币种 | 目录含 AUD 与非 AUD 餐厅 | 每家金额用自己的币种格式化，不借用他人币种 | Auto |
| REST-LIST-10 | P2 | 空目录 | 平台无任何餐厅 | 明确空状态与建店入口，不是加载中 | Auto |

## 7. 创建与编辑基本信息（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-EDIT-01 | P1 | PlatformOwner | 打开新建表单 | 分 Basic/Advanced 两个子分区；必填项标注清楚 | Auto |
| REST-EDIT-02 | P1 | 必填校验 | 全部留空提交 | 逐项提示；不发请求 | Auto |
| REST-EDIT-03 | P1 | 店名 | 纯空白、超长、前后空格 | 空白拒绝；超长有明确上限；存储值已 trim | Auto |
| REST-EDIT-04 | P1 | 电话 | 选国家区号并填本地号码 | 组合后为合法 E.164；非法号码被拒 | Auto |
| REST-EDIT-05 | P1 | 币种 | 切换为非 AUD 后保存 | 该店所有金额展示随之改变；历史订单币种不被改写 | Auto |
| REST-EDIT-06 | P0 | 时区 | 改为非本地时区并保存 | **营业状态与下次开门时间按新时区计算**；不按浏览器时区 | Auto |
| REST-EDIT-07 | P1 | 地址 | 多行地址与特殊字符 | 原样存储与展示；不破坏布局 | Auto |
| REST-EDIT-08 | P1 | 图片 URL | 合法 URL、非法 URL、留空 | 非法被拒；留空显示占位而不是坏图 | Auto |
| REST-EDIT-09 | P1 | 支付方式 | 切换 paymentPolicy 各选项 | 顾客端可用支付方式随之变化 | Auto |
| REST-EDIT-10 | P1 | 保存成功 | 改任意字段保存 | 提示成功；目录与数据库一致；审计有前后值 | Auto |
| REST-EDIT-11 | P1 | 取消 | 改后取消 | 无任何写入；重开表单恢复原值 | Auto |
| REST-EDIT-12 | P1 | 重复店名 | 建两家同名餐厅 | 按策略允许或拒绝，行为一致且提示明确 | Auto |
| REST-EDIT-13 | P1 | 建店成功 | 平台主建一家新餐厅 | 出现在目录；可被指派用户；桌台为空 | Auto |
| REST-EDIT-14 | P1 | 建店后归属 | 给新店指派一个 Admin | 该 Admin 只能看到并管理这家店 | Assisted |
| REST-EDIT-15 | P1 | 防重入 | 连续快速提交两次建店 | 只建一家；不产生重复脏数据 | Auto |
| REST-EDIT-16 | P1 | 审计 | 核对建店与改店审计 | 记录操作者与前后值；不记录 Stripe 密钥或 token | Auto |

## 8. 澳洲合规字段（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-AU-01 | P0 | ABN 校验和 | 输入 11 位但校验和错误的号码 | **后端拒绝**；前端提示可读，不只靠位数判断 | Auto |
| REST-AU-02 | P0 | ABN 合法 | 输入校验和正确的 ABN | 接受；存储为规范化后的纯数字 | Auto |
| REST-AU-03 | P1 | ABN 格式 | 输入带空格/短横线的写法 | 规范化后接受，存储不含分隔符 | Auto |
| REST-AU-04 | P1 | ABN 位数 | 10 位与 12 位 | 拒绝并提示位数要求 | Auto |
| REST-AU-05 | P1 | ABN 留空 | 不填 ABN 保存 | 允许留空；**顾客端收据据此降级而不是显示空 ABN** | Auto |
| REST-AU-06 | P1 | 法定名称 | 填写与店名不同的 legalBusinessName | 收据与发票使用法定名称 | Assisted |
| REST-AU-07 | P1 | GST 登记 | 切换 gstRegistered | 顾客端税务信息随之变化；未登记时不显示 GST 行 | Assisted |
| REST-AU-08 | P1 | 含税价 | 切换 pricesIncludeGst | 与 GST 登记状态组合后行为一致，不出现自相矛盾的收据 | Assisted |
| REST-AU-09 | P1 | 退款联系邮箱 | 填写与业务邮箱不同的退款邮箱 | 退款相关页面/邮件使用退款邮箱 | Assisted |
| REST-AU-10 | P1 | 邮箱格式 | 业务/退款邮箱填非法格式 | 拒绝并提示；不写库 | Auto |
| REST-AU-11 | P1 | 附加费告知 | 填写 customerSurchargeNotice | 顾客结账前可见；空值时不显示空区块 | Assisted |
| REST-AU-12 | P1 | 从 Stripe 导入 | 对已连接账号点导入 | 自动填入可拿到的身份字段；**ABN 仍可手工编辑** | Assisted |
| REST-AU-13 | P1 | 导入不越权推断 | 检查导入后的其他字段 | 不自动推断 GST 登记、含税价、退款邮箱、附加费与过敏原 | Auto |
| REST-AU-14 | P1 | 未连接时导入 | 对未连接 Stripe 的店点导入 | 明确说明需要先连接；不报内部错误 | Auto |

## 9. 支付设置、Stripe Connect 与平台服务费（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-PAY-01 | P1 | 任意管理角色 | 打开支付设置 | 显示当前 Connect 状态与费率；只读字段不可编辑 | Auto |
| REST-PAY-02 | P0 | 非平台主 | `PATCH /{id}/payment-settings` | 403（见 REST-ROLE-12） | Auto |
| REST-PAY-03 | P1 | 平台主 | 设置一次性平台费为 0 | 接受（表示不收） | Auto |
| REST-PAY-04 | P1 | 平台主 | 设置一次性平台费为 1～49 | **拒绝**：非零一次性费用不得低于 50 最小货币单位 | Auto |
| REST-PAY-05 | P1 | 平台主 | 设置为 50 与较大值 | 接受；费用预览与之一致 | Auto |
| REST-PAY-06 | P1 | 平台主 | 设置负数与非数字 | 拒绝并提示；不写库 | Auto |
| REST-PAY-07 | P1 | 费率预览 | 改费率后看预览 | 预览金额与后端计算一致，币种为该店币种 | Auto |
| REST-PAY-08 | P1 | Stripe 未配置 | 清空 Stripe 密钥后调 platform-fee/checkout | **503 且文案明确**，不是 500 或空白 | Auto |
| REST-PAY-09 | P1 | Connect 未连接 | 点开始 onboarding | 生成测试模式链接；不在页面暴露密钥 | Assisted |
| REST-PAY-10 | P1 | onboarding 返回 | 带 `?stripeConnect=return` 回到页面 | 显示明确结果提示；刷新后不重复提示 | Auto |
| REST-PAY-11 | P1 | onboarding 放弃 | 带 `?stripeConnect=refresh` 回到页面 | 提示可重试；状态未被误标为已完成 | Auto |
| REST-PAY-12 | P1 | 刷新状态 | 点 refresh | 状态与 Stripe 一致；失败时提示可读 | Assisted |
| REST-PAY-13 | P1 | 诊断 | 运行 diagnostics | 列出缺失项；**不显示账号密钥或完整 token** | Assisted |
| REST-PAY-14 | P1 | 平台费结账 | 发起 platform-fee/checkout | 跳转测试模式结账；`{CHECKOUT_SESSION_ID}` 占位符**未被 URL 编码** | Auto |
| REST-PAY-15 | P1 | 结账返回 | 带 `?platformFee=success` / `=cancelled` 回到页面 | 两种结果提示不同且正确 | Auto |
| REST-PAY-16 | P1 | 未就绪时下单 | Connect 未就绪的店尝试在线支付 | 顾客端被明确阻止，而不是走到一半失败 | Assisted |

## 10. 营业时间与特殊日历（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-HOURS-01 | P1 | Hours 分区 | 打开并选择餐厅 | 显示七天配置；平台主有餐厅选择器 | Auto |
| REST-HOURS-02 | P1 | 单窗口 | 设某天 09:00–17:00 | 保存成功；顾客端该时段可下单 | Auto |
| REST-HOURS-03 | P1 | 多窗口 | 设某天两段（午市/晚市） | 两段之间为休息，顾客端一致 | Auto |
| REST-HOURS-04 | P1 | 跨夜 | 设 18:00–02:00 | 次日凌晨仍算营业；下次开门时间正确 | Auto |
| REST-HOURS-05 | P1 | 24 小时 | 设为全天营业 | 任何时刻都营业；不出现"即将关门" | Auto |
| REST-HOURS-06 | P1 | 全天关闭 | 某天设为休息 | 顾客端该天不可下单，并显示下次开门 | Auto |
| REST-HOURS-07 | P1 | 非法区间 | 结束早于开始、重叠窗口 | 拒绝并提示；不写库 | Auto |
| REST-HOURS-08 | P0 | 时区 | 在非本地时区的店验证边界时刻 | 以餐厅时区判定，不受浏览器时区影响 | Auto |
| REST-HOURS-09 | P1 | 特殊关闭 | Calendar 加一天关闭 | 该天覆盖每周排班；顾客端不可下单 | Auto |
| REST-HOURS-10 | P1 | 特殊营业 | 在每周休息日加一天营业 | 该天可下单 | Auto |
| REST-HOURS-11 | P1 | 特殊跨夜 | 特殊日设跨夜窗口 | 与每周跨夜行为一致 | Auto |
| REST-HOURS-12 | P1 | 过期特殊日 | 保留一个已过去的特殊日 | 不影响当前营业判定；界面不误导 | Auto |
| REST-HOURS-13 | P1 | 非法特殊日 | 重复日期、非法日期、非法时段 | 拒绝并提示 | Auto |
| REST-HOURS-14 | P0 | 并发保存 | 两个管理员同时保存同一份日历 | **返回 409 `schedule_conflict`**，界面提示"已被他人保存"，不静默覆盖 | Assisted |
| REST-HOURS-15 | P1 | 并发另一半 | 一人保存 Hours、另一人保存 Calendar | 两者互不覆盖（各自只写自己的列） | Assisted |
| REST-HOURS-16 | P1 | 旧客户端 | 不带版本字段保存 | 仍允许保存（向后兼容），不因缺字段报错 | Auto |
| REST-HOURS-17 | P1 | 保存后一致性 | 保存后对比顾客端与员工端 | 三处营业状态一致 | Auto |
| REST-HOURS-18 | P1 | 审计 | 核对 Hours/Calendar 保存审计 | 有前后值；失败与取消不产生成功记录 | Auto |

## 11. 接单暂停与营业状态（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-OPS-01 | P1 | 营业中 | 点关闭并选择一个时长 | 立即停止接单；显示恢复时间 | Auto |
| REST-OPS-02 | P1 | 无限期关闭 | 选择不设时长 | 持续关闭直到手工恢复 | Auto |
| REST-OPS-03 | P0 | 暂停到期 | 把到期时间改到过去后刷新 | **顾客端、员工端与管理端一致显示接单中**；不读原始列 | Auto |
| REST-OPS-04 | P1 | 手工恢复 | 暂停中点恢复 | 立即可接单；到期时间被清空 | Auto |
| REST-OPS-05 | P1 | 关闭期间下单 | 顾客尝试下单 | 被明确阻止并说明原因 | Assisted |
| REST-OPS-06 | P1 | 关闭与排班叠加 | 排班内关闭、排班外恢复 | 手工关闭优先；恢复后仍受排班约束 | Auto |
| REST-OPS-07 | P1 | 停用餐厅 | 设 isActive=false | 顾客端不可见；管理端仍可查看与恢复 | Auto |
| REST-OPS-08 | P1 | 停用后下单 | 用旧链接/桌码访问 | 明确不可用，不泄露菜单 | Auto |
| REST-OPS-09 | P1 | 重新启用 | 设回 isActive=true | 顾客端恢复可见 | Auto |
| REST-OPS-10 | P1 | 平台主批量视角 | 目录中同时看到多店状态 | 每家状态独立正确，不串 | Auto |
| REST-OPS-11 | P1 | 名称归属 | 检查暂停控件 | **控件上写明是哪家餐厅**，尤其平台主视角 | Auto |
| REST-OPS-12 | P1 | 审计 | 核对暂停/恢复/停用审计 | 记录操作者、餐厅与前后值 | Auto |

## 12. 桌台与二维码（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-TABLE-01 | P1 | Tables 分区 | 打开并选择餐厅 | 按桌号排序；显示启用状态 | Auto |
| REST-TABLE-02 | P1 | 新建 | 建一个新桌台 | 成功；**自动生成 qrToken**；出现在列表 | Auto |
| REST-TABLE-03 | P0 | 桌号唯一 | 建一个已存在的桌号 | 拒绝并提示；**同店内桌号唯一** | Auto |
| REST-TABLE-04 | P1 | 跨店同号 | 在餐厅 B 建与 A 相同的桌号 | 允许；唯一性只在店内 | Auto |
| REST-TABLE-05 | P1 | 桌号格式 | 空白、超长、前后空格、`10` 与 `2` 混排 | 空白拒绝；存储已 trim；排序不把 10 排在 2 前面（或明确按字符串排序） | Auto |
| REST-TABLE-06 | P1 | 改桌号 | 改为未占用的号 | 成功；**qrToken 保持不变**，已印二维码仍有效 | Auto |
| REST-TABLE-07 | P0 | 改成已占用 | 改为同店已存在的号 | 拒绝；不产生重复 | Auto |
| REST-TABLE-08 | P1 | 停用桌台 | 设 isActive=false | 桌码不再可下单；管理端仍可见并可恢复 | Auto |
| REST-TABLE-09 | P1 | 无删除端点 | 尝试 `DELETE /api/tables/{id}` | **405/404**；产品语义是停用而非删除，界面不应提供"删除" | Auto |
| REST-TABLE-10 | P1 | 二维码内容 | 对比 QR、Copy 与 Open 三者 | 三者完全一致；指向测试前端 | Assisted |
| REST-TABLE-11 | P1 | 桌码可用 | 扫码进入点单页 | 进入正确餐厅与桌号 | Assisted |
| REST-TABLE-12 | P1 | 停用店的桌码 | 餐厅 isActive=false 后扫码 | 明确不可用；不泄露菜单 | Auto |
| REST-TABLE-13 | P1 | token 保密 | 检查报告与截图 | **不记录完整 qrToken**；URL 只在测试环境 | Auto |
| REST-TABLE-14 | P1 | 审计 | 核对建/改/停用桌台审计 | 记录操作者与前后值 | Auto |

## 13. 删除餐厅（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-DEL-01 | P0 | 非平台主 | 删自己的餐厅 | 403（见 REST-ROLE-11） | Auto |
| REST-DEL-02 | P1 | 平台主 | 打开删除确认 | 需要明确确认；默认不可直接提交 | Auto |
| REST-DEL-03 | P1 | 取消 | 确认后取消 | 无任何删除 | Auto |
| REST-DEL-04 | P0 | 一次性空壳店 | 确认删除 | 从目录消失；数据库中确实不存在 | Auto |
| REST-DEL-05 | P0 | 有订单的餐厅 | 尝试删除 | **按策略拒绝或安全归档**；不得留下悬空订单/支付/桌台引用 | Auto |
| REST-DEL-06 | P0 | 有员工归属的餐厅 | 尝试删除 | 不得留下 `RestaurantId` 指向已删除餐厅的账号 | Auto |
| REST-DEL-07 | P1 | 重复删除 | 对已删除 id 再次调用 | 404；不产生第二条成功审计 | Auto |
| REST-DEL-08 | P1 | 审计 | 核对删除审计 | 记录操作者与餐厅标识；删除后仍可追溯 | Auto |

## 14. 并发、恢复、无障碍与响应式（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| REST-REC-01 | P1 | 两名管理员 | 同时编辑同一餐厅基本信息并先后保存 | 结果可解释；**不得静默丢失一方的全部修改** | Assisted |
| REST-REC-02 | P0 | 排班并发 | 见 REST-HOURS-14 | 409 冲突而非覆盖 | Assisted |
| REST-REC-03 | P1 | 请求中断 | 保存/建店/删除/桌台写入时刷新或断网 | 以服务器为准；无假成功、重复写入或永久 busy | Auto |
| REST-REC-04 | P1 | API 401/403/429/500/503 | 覆盖各操作的错误呈现 | 短消息可重试；**不显示 Stripe 密钥、SQL、堆栈或内部地址** | Auto |
| REST-REC-05 | P1 | 会话过期 | 停留后执行写操作 | 引导重新登录；表单内容不无声丢失 | Assisted |
| REST-REC-06 | P1 | 页面语义 | 检查 H1、分区 Tabs、表单分组、Dialog | 唯一 H1（含 sr-only）；Tabs 有名称与选中状态 | Auto/Assisted |
| REST-REC-07 | P1 | 控件命名 | 检查图标按钮与开关 | 暂停、停用、导入、诊断、二维码都有可读名称，不只靠图标 | Auto |
| REST-REC-08 | P1 | 纯键盘 | 完成建店→改合规→存排班→建桌台全流程 | 焦点顺序合理可见、无陷阱；Dialog 关闭返回触发器 | Assisted |
| REST-REC-09 | P2 | 屏幕阅读器 | 读取营业状态、Connect 状态、排班表格 | 状态语义可读；动态变化通过合适 live region 宣告 | Assisted |
| REST-REC-10 | P1 | 390/430px 手机 | 浏览目录、表单、排班与二维码 | 无横向溢出；QR 与输入不被遮挡 | Assisted |
| REST-REC-11 | P1 | 平板/200% zoom | 重复关键操作 | 排班表格降级可用；Popover/Dialog 可滚动可关闭 | Assisted |
| REST-REC-12 | P1 | 前端自动化 | 运行 restaurant/openingHours/tables 相关单测 | 正常、失败、权限、并发有稳定断言 | Auto |
| REST-REC-13 | P1 | 后端自动化 | 运行 restaurant 权限、ABN、排班并发测试 | 关键权限/校验/并发通过且无关键 skip | Auto |
| REST-REC-14 | P1 | 测试结束 | 核对数据库与前台 | 餐厅、排班、桌台、支付设置全部恢复；一次性餐厅已清理；截图无生产桌码或密钥 | Auto |

## 15. 推荐执行顺序

1. `REST-PRE-*`，确认身份、基线与 Stripe 处于测试模式。
2. `REST-ROLE-*`，先把三个 PlatformOwnerOnly 端点和跨租户边界钉死。
3. 只读的 `REST-LIST-*`。
4. `REST-EDIT-*`、`REST-AU-*`，用一次性餐厅，每组结束即恢复。
5. `REST-HOURS-*`、`REST-OPS-*`，**这两组会影响顾客能否下单**，务必用专用测试餐厅并逐项恢复。
6. `REST-TABLE-*`，注意二维码不外泄。
7. `REST-PAY-*`，只在 Stripe 测试模式执行。
8. `REST-DEL-*`，只对本轮一次性空壳餐厅。
9. 并发、故障、无障碍、响应式与最终清理。

## 16. 用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| 扫码 | 用测试手机扫指定桌码 | 解析 URL 与餐厅/桌号一致，不打开生产桌码 |
| Stripe onboarding | 在测试模式完成一次 Connect 引导 | 状态、诊断与导入字段随之更新 |
| 平台费结账 | 用测试卡完成一次平台费支付 | 返回参数、提示与账务记录一致 |
| 营业影响 | 在指定测试餐厅观察暂停/恢复后的顾客端 | 三端营业状态一致 |
| 时区 | 把设备时区改成与餐厅不同后查看营业状态 | 判定仍以餐厅时区为准 |
| 屏幕阅读器 | 用 VoiceOver 读营业状态与 Connect 状态 | 状态语义与提示正确 |

## 17. 完成标准

- 所有被选 `REST-*` 都记录为 PASS/FAIL/BLOCKED/NOT RUN；部分观察不能冒充 PASS。
- **P0 任一失败即阻止上线结论**：跨租户读写、建店/删店/费率越权、ABN 校验和绕过、时区判定错误、暂停到期后状态不一致、桌号重复、删店留下悬空数据、排班并发静默覆盖。
- 每个写操作在数据库、管理端 UI 与顾客端三处一致，并完成恢复。
- Stripe 全程处于测试模式，报告中无密钥、无完整 token、无生产桌码。
- 本包通过不代表顾客下单、支付、退款、打印或完整 release/full 验收通过。
