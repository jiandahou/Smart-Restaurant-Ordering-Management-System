# DineFlow Dashboard 专项测试用例

测试包名称：`dashboard`  
稳定用例前缀：`DASH-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `dashboard`、某个 `DASH-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/admin` Dashboard 的角色入口、统计指标、最近订单、公开菜单/桌码、营业状态、暂停接单、Opening hours、Special calendar、Watched menu items 和用户级布局定制。它是独立的部分功能测试，不自动扩展到完整订单履约、真实付款、退款、打印或发布验收。

最近一次执行记录：[dashboard-test-run-2026-08-11.md](dashboard-test-run-2026-08-11.md)（122 条中 85 PASS / 12 FAIL / 25 NOT RUN）。不要用旧结果代替复测。

## 1. 执行与安全规则

- 仅在 Local/Test/Staging 执行会改变接单状态、营业时间、特殊日期、库存或菜单可用性的用例；Production 默认只读。
- 测试前记录并在结束时恢复：餐厅 acceptingOrders/暂停到期、openingHoursJson、specialOpeningDaysJson、Watched 状态、库存、可用状态和 Dashboard localStorage 布局。
- PlatformOwner 至少准备两个餐厅；租户隔离用例必须使用 A/B 两个明确不同餐厅，不能只根据导航隐藏判断通过。
- 统计值必须与 API/数据库测试快照交叉核对；多币种金额不能在没有明确汇率/分组政策时合并成一个币种。
- Copy/QR/Open 只允许指向本地或测试前端；不得把生产桌码、私人 Token 或完整订单访问 Token 写入报告。
- Dashboard 快捷操作会影响公开菜单和接单，必须使用测试餐厅/测试菜品并逐项清理。
- 本文件只定义用例；增加或修改用例不会自动开始浏览器操作。

## 2. 推荐夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| PlatformOwner | 可见至少 4 个餐厅，其中 active/inactive、accepting/paused 均有 | 平台范围、排序、上限、多币种 |
| RestaurantOwner A/B | 分属两个餐厅 | 租户隔离与营业配置 |
| Admin A/B | 分属两个餐厅 | Dashboard/菜单/库存隔离 |
| Staff A/B | 分属两个餐厅 | 只读营业状态和受限 Widget |
| Customer/Guest | 无后台角色 | `/admin` 拒绝与无数据闪现 |
| Orders fixture | 至少 7 单，覆盖状态、支付状态、堂食/外带和两种币种 | 指标和最近 5 单 |
| Tables fixture | active/inactive、带/不带 qrToken，编号 1/2/10 | URL、排序、过滤 |
| Watched items | tracked/unlimited、0/1/较大库存、available/unavailable | 快捷库存操作 |
| Schedule fixture | 24h、跨夜、多窗口、时区、特殊关闭/营业 | 营业状态与日历 |
| Two tabs/devices | 同账号两标签、A/B 两租户、窄屏/触屏 | 并发、布局、响应式 |

## 3. 前置检查（6）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-PRE-01 | P1 | 项目目录 | 记录分支、提交、dirty 数量、Node/.NET、环境和服务地址 | 不覆盖用户改动；明确不是误用生产环境 | Auto |
| DASH-PRE-02 | P1 | 角色账号 | 解析 PlatformOwner、Owner/Admin/Staff A/B、Customer 的 UserId/角色/restaurantId | 每个身份唯一且餐厅归属明确；不记录密码/Token | Auto |
| DASH-PRE-03 | P1 | 数据库/API | 保存餐厅、订单汇总、最近订单、桌台、Watched items 和时区基线 | 后置结果可精确核对和恢复 | Auto |
| DASH-PRE-04 | P1 | 可变更夹具 | 指定允许暂停的测试餐厅、可改营业时间的餐厅和可改库存菜品 | 未授权真实营业数据不得执行写操作 | Auto |
| DASH-PRE-05 | P2 | 浏览器 | 记录各测试用户的 Dashboard layout storage key 和现有布局 | 不读取认证存储；仅处理 Dashboard 布局偏好 | Auto |
| DASH-PRE-06 | P1 | 清理计划 | 定义最终 acceptingOrders、schedule、calendar、库存、watch 和布局状态 | 每个写入用例都有清理责任人 | Auto |

## 4. 路由、角色与租户隔离（12）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-ROLE-01 | P1 | 未登录 | 直接打开/刷新 `/admin` 并后退 | 跳转登录；不闪现订单、金额、餐厅或桌码 | Auto |
| DASH-ROLE-02 | P1 | PlatformOwner | 登录并打开 `/admin` | 唯一 H1 为 Dashboard；显示 Platform owner 标签和平台范围数据 | Auto |
| DASH-ROLE-03 | P0 | RestaurantOwner A | 打开 Dashboard 并调用汇总/订单/餐厅 API | 只看到餐厅 A；不能获得 B 的指标、订单、URL 或配置 | Auto |
| DASH-ROLE-04 | P0 | Admin A | 同上，并检查 Watched/schedule Widget | 只读写餐厅 A；restaurantId 参数不能越权到 B | Auto |
| DASH-ROLE-05 | P0 | Staff A | 打开 Dashboard 与直接调用受限 API | 只见 Staff workspace、自己餐厅订单和只读状态；无 schedule/Watched/table URL/Payments 写入口 | Auto |
| DASH-ROLE-06 | P1 | Customer | 直接打开 `/admin`、刷新和浏览器后退 | 拒绝且无后台数据闪现 | Auto |
| DASH-ROLE-07 | P1 | Guest | 打开 `/admin` 与复制历史深链 | 进入登录；URL 不泄露 restaurantId/qrToken | Auto |
| DASH-ROLE-08 | P0 | A 账号+B IDs | 替换 summary/orders/tables/menu/schedule 的 restaurantId/itemId | 403/404；不泄露 B 是否存在且无写入 | Auto |
| DASH-ROLE-09 | P1 | 角色被移除/禁用 | 保留旧 Dashboard 页面后刷新/Refresh | 会话按政策失效；旧数据清空而非继续可操作 | Auto |
| DASH-ROLE-10 | P1 | 同一浏览器切换角色 | Owner→Staff→PlatformOwner 依次登录 | Widget 注册表和 layout 按当前用户/角色重算；不残留上个账号数据 | Auto |
| DASH-ROLE-11 | P1 | 同时拥有 Staff+Admin 的用户 | 打开 Dashboard 并检查 Widget 集合 | 前端 `isStaff` 仅在纯 Staff 时为真；混合角色按更高权限渲染，且后端授权与之一致 | Auto |
| DASH-ROLE-12 | P1 | Admin/Staff 未分配 restaurantId | 打开 Dashboard 并调用 summary/restaurants | 后端返回 403 且文案明确；页面显示可读错误而非空白或全 0 假数据 | Auto |

## 5. 页面加载、营业状态与指标（17）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-SUM-01 | P1 | 任意后台角色 | 初次打开 Dashboard | Loading 后显示 Hero、状态、4 个指标和可用 Widget；无重复 H1 | Auto |
| DASH-SUM-02 | P1 | API 快照 | 对比 Orders、Kitchen active、Paid、Awaiting payment、payable、revenue | UI 数字与同一权限范围的 API/DB 一致 | Auto |
| DASH-SUM-03 | P1 | 7+ orders | 检查 summary 与 recent list | 汇总使用完整范围；列表只取最新 5，不能把 5 单当总数 | Auto |
| DASH-SUM-04 | P1 | 状态组合 | 覆盖 Pending/Accepted/Preparing/Ready/Completed/Cancelled | Kitchen active 只计算政策定义的进行中状态 | Auto |
| DASH-SUM-05 | P1 | 支付组合 | 覆盖 Paid/Pending/Failed/Refunded/Pay at counter | Paid/revenue/pending/payable 分类正确，不把失败或退款当收入 | Auto |
| DASH-SUM-06 | P1 | 无订单 | 打开 Dashboard | 所有指标为 0 和正确币种格式；Recent orders 显示空状态 | Auto |
| DASH-SUM-07 | P2 | 大数/小数 | 使用大金额、0、舍入边界和负向退款快照 | 不溢出；minor units/小数位与币种一致 | Auto |
| DASH-SUM-08 | P0 | PlatformOwner 多币种 | 同时存在 AUD/NPR/INR 餐厅收入 | 不把不同币种直接相加并标成首个餐厅币种；按明确政策分组/解释 | Auto |
| DASH-SUM-09 | P1 | 餐厅时区≠浏览器 | 查看状态和 next transition | 使用服务器餐厅时间；不因浏览器时区错判 Open/Closed | Auto |
| DASH-SUM-10 | P1 | Inactive/Paused/Outside hours/Open | 依次建立四种 availability | Banner headline、reason、恢复时间与 acceptingOrders 一致 | Auto |
| DASH-SUM-11 | P2 | 点击 Refresh | 单击、双击、加载中再次点击 | 按钮为 Refreshing 且禁用；完成后一次成功提示、数据一致 | Auto |
| DASH-SUM-12 | P1 | 一项 API 401/403/500 | 加载或 Refresh | 不显示堆栈/内部 URL/旧租户数据；错误简短且可重试 | Auto |
| DASH-SUM-13 | P1 | orders 成功、restaurant/status 失败及反向 | 模拟部分失败 | 页面不混合成看似完整的错误快照；恢复后统一刷新 | Auto |
| DASH-SUM-14 | P2 | 慢请求/切换账号 | 加载中登出或换用户 | 旧请求结果不得覆盖新账号 Dashboard | Auto |
| DASH-SUM-15 | P0 | PlatformOwner 多餐厅 | 对比 Hero 状态 Banner/Pause 控件作用域与 4 个指标作用域 | Banner 与 Pause 只作用于按名称排序的首家 active 餐厅，指标是平台全量；UI 必须点名该餐厅，不得让人读成"平台整体营业状态" | Auto |
| DASH-SUM-16 | P1 | Staff（无餐厅目录） | 查看 Paid 指标 detail 的币种；再用无订单的 Staff 账号复查 | 币种回退链 `餐厅→首单→AUD` 不得把他店/默认币种冒充为本店币种 | Auto |
| DASH-SUM-17 | P2 | PlatformOwner 餐厅数超过一页 | 检查 restaurants 请求分页参数与 Widget 显示 | 不拉全表；分页不得让应显示的 active 餐厅整体消失或排序错乱 | Auto |

## 6. Recent orders（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-ORD-01 | P1 | 7+ orders | 检查列表顺序 | 仅最新 5 单，按 createdAt 倒序且无重复 | Auto |
| DASH-ORD-02 | P1 | dine-in/takeaway | 检查副标题 | 堂食显示正确 Table；外带显示正确 orderType/餐厅 | Auto |
| DASH-ORD-03 | P1 | 多币种订单 | 检查每行金额 | 每单使用自身 currency，不继承错误 scopedCurrency | Auto |
| DASH-ORD-04 | P1 | 状态/支付组合 | 对比两个 Badge 与订单详情 | OrderStatusBadge/PaymentStatusBadge 不矛盾且可读 | Auto |
| DASH-ORD-05 | P0 | Tenant A/B | A 查看最近订单并替换 orderId | 只出现 A 的订单；B 的编号/金额/状态不泄露 | Auto |
| DASH-ORD-06 | P1 | Owner/Admin | 点击 Open orders/Open payments | 路由正确并保持当前租户；返回后 Dashboard 状态一致 | Auto |
| DASH-ORD-07 | P1 | Staff | 查看 footer 与 Process soon | 可进入 Orders；无 Payments 链接；未实现按钮明确 disabled | Auto |
| DASH-ORD-08 | P2 | 长编号/长餐厅名/Badge 组合 | 桌面、窄屏、200% zoom | 不覆盖金额/按钮；必要时换行或可访问截断 | Assisted |
| DASH-ORD-09 | P1 | 新订单实时到达 | Dashboard 保持打开并创建测试订单 | 依据产品刷新策略实时/手动更新且不会重复或乱序 | Auto/Assisted |
| DASH-ORD-10 | P1 | 篡改分页参数 | 用 Dashboard 的 token 直接请求 `pageSize` 超大值/负值/非数字 | 服务端有上限并规范化；不能借 Dashboard 入口把全量订单一次拉走 | Auto |

## 7. 公开菜单、桌码与 QR（13）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-URL-01 | P1 | PlatformOwner 5+ active | 查看 Public restaurant URLs | 按名称排序且最多显示 4；inactive 不进入快捷列表 | Auto |
| DASH-URL-02 | P0 | Owner/Admin A | 查看 Restaurant menu URL | 只显示餐厅 A；不能看到 B 的 public/table URL | Auto |
| DASH-URL-03 | P1 | Staff | 查看 URL Widget 与展开按钮 | 不暴露 admin-only table URLs；空/隐藏状态有清楚说明 | Auto |
| DASH-URL-04 | P1 | accepting/paused/inactive | 检查 Badge | Active/Inactive 与 Accepting/Paused 分别反映真实字段，不互相替代 | Auto |
| DASH-URL-05 | P1 | Clipboard 权限 | 点击 public URL Copy，再拒绝剪贴板权限重试 | 成功内容完全正确；失败为短提示且页面可继续使用 | Assisted |
| DASH-URL-06 | P1 | QR dialog | 打开 public QR，用测试扫码器解析 | QR 内容与页面 code/Open href 完全一致；关闭后焦点返回 QR 按钮 | Assisted |
| DASH-URL-07 | P1 | Open | 点击 public Open | 新标签为正确测试前端、含正确 restaurantId；使用 noopener/noreferrer | Auto |
| DASH-URL-08 | P1 | Tables 1/2/10 | 展开 table URLs | 只显示 active 且有 qrToken 的桌台；按数字顺序 1,2,10 | Auto |
| DASH-URL-09 | P1 | inactive/no-token table | 展开列表并直接构造 URL | 不显示/复制无效桌码；API 不能泄露其他租户 Token | Auto |
| DASH-URL-10 | P2 | 无有效桌台 | 展开 | 显示明确 empty state；不无限 Loading | Auto |
| DASH-URL-11 | P1 | tables API 401/403/500/慢请求 | 展开、收起、再次展开 | 短错误可重试；不重复并发加载；不显示旧餐厅桌台 | Auto |
| DASH-URL-12 | P2 | 长 Unicode 餐厅名/URL/移动端 | 打开卡片和 QR | 无横向溢出；code 可换行/滚动；按钮保持可操作 | Assisted |
| DASH-URL-13 | P2 | 展开后桌台变更 | 展开桌码 → 在另一处停用/新增桌台 → 收起再展开 | 缓存策略明确：要么重新拉取，要么不把已失效桌码当作可用；不得静默给出失效链接 | Auto |

## 8. 接单暂停、Opening hours 与 Special calendar（17）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-OPS-01 | P0 | Staff | 检查营业组件并直接调用写 API | 只读 status；不能暂停、改 weekly schedule 或 special calendar | Auto |
| DASH-OPS-02 | P1 | Owner/Admin | 暂停 15/30/60/120 分钟 | 立即停止接单；pausedUntil 与 UI 文案正确；到期自动恢复 | Auto |
| DASH-OPS-03 | P1 | 有 next opening | Pause until next opening | 恢复点使用餐厅时区和下一营业窗口 | Auto |
| DASH-OPS-04 | P1 | Owner/Admin | Indefinite pause 后 Reopen | 立即恢复；pausedUntil 清除；公开下单状态同步 | Auto |
| DASH-OPS-05 | P0 | 两标签/两管理员 | 同时 Pause/Reopen 或快速双击 | 最终状态确定、无旧响应覆盖新状态、审计完整 | Auto |
| DASH-OPS-06 | P1 | 写 API 失败/断网 | Pause/Reopen | UI 回滚服务器状态；按钮恢复；Toast 无堆栈 | Auto |
| DASH-OPS-07 | P1 | Weekly schedule | 保存正常七天营业时间 | JSON、Dashboard status、公开菜单可用性和 DB 一致 | Auto |
| DASH-OPS-08 | P1 | 24 hours/closed day | 设置 00:00–00:00 与关闭日 | 24h 与 closed 明确区分；跨午夜状态正确 | Auto |
| DASH-OPS-09 | P1 | 跨夜/多窗口 | 18:00–02:00、午休分段、边界相接/重叠 | 跨夜正确；非法重叠/零长被拒绝；不产生部分保存 | Auto |
| DASH-OPS-10 | P2 | Copy day/Add/Remove/Cancel | 编辑后 Cancel/刷新/切换餐厅 | 未保存草稿不写 DB；切换时有 discard 防护 | Auto |
| DASH-OPS-11 | P1 | 非法/旧 JSON | 打开 schedule | 安全 fallback 并明确警告；不因保存 fallback 静默覆盖旧值 | Auto |
| DASH-OPS-12 | P1 | PlatformOwner A/B | 切换 Opening hours 餐厅并保存 | 只更新选中餐厅；草稿不串店；时区标签随选择更新 | Auto |
| DASH-OPS-13 | P1 | Special day | 为未来日期设 Closed、Special hours、恢复 Normal | override 唯一、排序稳定；状态覆盖 weekly schedule | Auto |
| DASH-OPS-14 | P1 | 日期/窗口边界 | 重复日期、过去/今天、跨年、闰日、跨夜、空 special windows | 规范化或明确拒绝；不产生重复/冲突 override | Auto |
| DASH-OPS-15 | P1 | PlatformOwner A/B | 切换 Special calendar 并处理未保存草稿 | discard 提示有效；记忆窗口不串到另一餐厅/日期 | Auto |
| DASH-OPS-16 | P1 | schedule/calendar API 403/409/500 | 保存、重试、另一标签并发保存 | 无局部写入；冲突可解释；重新加载后以服务器为准 | Auto |
| DASH-OPS-17 | P1 | pausedUntil 即将到期 | 暂停到 T+2 分钟，页面保持打开跨过 T，不手动刷新 | 到期后公开下单必须已恢复；Dashboard 若仍显示 Paused，属于陈旧展示而非真实状态，需记录为缺陷或明确的手动刷新策略 | Auto |

## 9. Watched menu items 与库存快捷操作（19）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-WATCH-01 | P1 | 无 watched item | 打开 Widget | 显示引导 empty state；无写入 | Auto |
| DASH-WATCH-02 | P1 | Owner/Admin A | 加载 watched items | 只显示 A 的 item、category、price/currency、状态 | Auto |
| DASH-WATCH-03 | P0 | Staff/Customer | 检查 Widget 与直接调用 watched/write API | Widget 不出现；API 403/404 且无写入 | Auto |
| DASH-WATCH-04 | P0 | Admin A+B itemId | 调 availability/stock/watch API | 拒绝且不泄露 B；B 的 item 完全不变 | Auto |
| DASH-WATCH-05 | P1 | available item | 切换 available off/on | DB、Dashboard、公开菜单一致；busy 时禁止重复提交 | Auto |
| DASH-WATCH-06 | P1 | tracked stock=1 | Decrease 到 0 | stock=0、Sold out Badge 和公开不可下单状态一致 | Auto |
| DASH-WATCH-07 | P1 | stock=0 | 再次 Decrease、随后 Increase | 不能负数；Decrease disabled；Increase 后 sold-out 按政策恢复 | Auto |
| DASH-WATCH-08 | P1 | tracked large stock | 快速多次 +/- 与双击 | 不丢增量、不旧响应覆盖新值；最终值与 DB 一致 | Auto |
| DASH-WATCH-09 | P1 | unlimited item | 点击 Unlimited 开始跟踪 | 按产品默认设为 10；审计和公开库存策略一致 | Auto |
| DASH-WATCH-10 | P1 | tracked item | Stop tracking | stockQuantity=null、显示 Unlimited；不错误修改 available | Auto |
| DASH-WATCH-11 | P1 | watched item | Stop watching | 仅从 Widget 移除，菜品/库存/available 不被删除或重置 | Auto |
| DASH-WATCH-12 | P1 | API 400/403/409/500/断网 | 对 toggle/stock/unwatch 分别失败 | UI 保留旧值、按钮恢复、错误短且可重试 | Auto |
| DASH-WATCH-13 | P0 | 两 Staff/Admin 或结账并发 | 最后一份库存与 Dashboard +/- 同时发生 | 原子更新，不负库存、不超卖；冲突可恢复 | Auto |
| DASH-WATCH-14 | P1 | 菜单页同时编辑 | Dashboard 与 Menu 两标签修改同一 item | 刷新/冲突策略确定；不静默覆盖更新字段 | Auto |
| DASH-WATCH-15 | P2 | 长 Unicode 名、无 category、大价格 | 桌面/窄屏/200% zoom | 名称、按钮、库存、Badge 不重叠；Uncategorised/币种正确 | Assisted |
| DASH-WATCH-16 | P1 | 审计/通知 | 完成 toggle、stock、unwatch 并恢复 | 只记录实际成功动作；无重复审计或敏感数据 | Auto |
| DASH-WATCH-17 | P1 | PlatformOwner 多餐厅 | 在 Opening hours 面板切换到餐厅 B，再看 Watched Widget | Watched 的餐厅作用域必须与用户当前所选餐厅一致或明确标注为首家餐厅；不得让人以为在改 B 店库存 | Auto |
| DASH-WATCH-18 | P0 | stock 写接口语义 | 检查 PATCH stock 是绝对值还是增量；两端同时基于同一旧值各 +1 | 绝对值写入必然产生丢失更新，需服务端原子递增或并发校验；结果不得静默少加 | Auto |
| DASH-WATCH-19 | P1 | 多币种 | PlatformOwner 下查看 watched item 价格 | 价格币种必须是该 item 所属餐厅的币种，不得套用 Dashboard 的 scopedCurrency | Auto |

## 10. Dashboard 布局定制（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-LAYOUT-01 | P2 | 新用户/无 storage | 打开 Dashboard | 使用 registry 默认顺序和每个 Widget 第一个 allowed size | Auto |
| DASH-LAYOUT-02 | P2 | 普通查看 | 未点 Customize 检查控件 | Move/resize/hide 工具不出现；不会误改营业数据 | Auto |
| DASH-LAYOUT-03 | P1 | Customize | Move earlier/later | 只改变草稿顺序，大小/隐藏状态不变；边界按钮 disabled | Auto |
| DASH-LAYOUT-04 | P1 | Mouse drag | 拖一张卡到另一张前 | 有 drag/drop 状态；保存后顺序正确 | Assisted |
| DASH-LAYOUT-05 | P1 | Keyboard | Space、Arrow、Space/Escape 拖放 | 可完成/取消；有屏幕阅读器 announcement，无焦点陷阱 | Assisted |
| DASH-LAYOUT-06 | P2 | Touch | 长按拖动并滚动页面 | 180ms 手势区分拖动/滚动；不误触业务按钮 | Assisted |
| DASH-LAYOUT-07 | P1 | Resize | 对每个 Widget 选择全部 allowed sizes 和非法 size | 只接受允许尺寸；内容和按钮仍可达 | Auto |
| DASH-LAYOUT-08 | P1 | Hide/Show | 隐藏一个、恢复一个、隐藏全部 | Hidden 列表正确；全部隐藏有恢复 empty state | Auto |
| DASH-LAYOUT-09 | P1 | Cancel | 修改顺序/尺寸/隐藏后 Cancel | 草稿全部丢弃；storage/业务数据不变 | Auto |
| DASH-LAYOUT-10 | P1 | Undo | 连续多步修改后逐步 Undo | 每次回到上一草稿；最多 20 层且不影响已保存布局 | Auto |
| DASH-LAYOUT-11 | P1 | Default | 自定义后点 Default，再 Cancel/Save | Default 仅改草稿；Cancel 恢复，Save 才持久化 | Auto |
| DASH-LAYOUT-12 | P1 | Save | 保存、刷新、关闭重开 | 顺序/尺寸/隐藏按当前用户持久化；无变化显示 unchanged | Auto |
| DASH-LAYOUT-13 | P2 | Save Toast Undo | 保存后点 Toast Undo | 恢复保存前布局并持久化；业务数据不受影响 | Auto |
| DASH-LAYOUT-14 | P0 | 两用户同浏览器 | A/B 保存不同布局后切换 | storage key 按 userId 隔离；不读取对方布局 | Auto |
| DASH-LAYOUT-15 | P1 | 角色变化 | Admin 保存含 schedule/watch 布局后变 Staff | 不允许的 Widget 被丢弃；返回 Admin 时按明确策略恢复/追加 | Auto |
| DASH-LAYOUT-16 | P1 | 新/删除 Widget | 使用旧 layout 打开新版本 | 未知/重复 id 删除；新 Widget 追加；非法 size clamp 到默认 | Auto |
| DASH-LAYOUT-17 | P1 | 损坏/不可用 localStorage | 非数组、坏 JSON、quota/private mode | 回退默认且 Dashboard 可用；不显示堆栈 | Auto |
| DASH-LAYOUT-18 | P2 | legacy v2 | 仅存在旧 unscoped layout | 安全迁移一次；不能把旧用户布局泄露给另一账号 | Auto |
| DASH-LAYOUT-19 | P2 | 从未点过 Customize | 首次打开 Dashboard 后立即检查 storage | 是否未编辑就写入默认布局要有明确结论；若写入，必须不固化他人偏好、不影响后续版本迁移 | Auto |
| DASH-LAYOUT-20 | P0 | legacy key + 两账号 | A 留下旧 unscoped layout 后登出，B 在同浏览器首次打开 Dashboard | B 不得读到 A 的布局；迁移必须绑定到写入者身份，否则视为跨账号偏好泄露 | Auto |

## 11. 恢复、无障碍、响应式与质量（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DASH-REC-01 | P1 | 两个同账号标签 | A 改 layout，B 改营业/库存并刷新 | 布局偏好与服务器业务数据互不覆盖；最终状态可解释 | Auto |
| DASH-REC-02 | P1 | 请求中刷新/关闭 | Refresh、Pause、schedule save、stock update 时中断 | 重新打开以服务器为准；无假成功、重复写入或永久 busy | Auto |
| DASH-REC-03 | P1 | API 401/403/429/500 | 覆盖各 Widget Toast/inline error | 短消息、可重试；不显示 SQL、堆栈、内部地址或 Token | Auto |
| DASH-REC-04 | P1 | 审计 | 对 Pause/schedule/calendar/watch/stock 成功失败取消逐项核对 | 仅成功安全事件有适当日志；用户、餐厅、前后值正确 | Auto |
| DASH-REC-05 | P1 | 页面语义 | 检查 H1、region、Badge、status、Dialog、loading | 唯一 Dashboard H1；所有互动控件有名称/状态，不只靠颜色 | Auto/Assisted |
| DASH-REC-06 | P1 | 纯键盘 | Refresh、链接、展开桌码、QR、Customize、schedule、Watched | 焦点顺序合理、可见、无陷阱；Dialog 关闭返回触发器 | Assisted |
| DASH-REC-07 | P2 | 屏幕阅读器 | 读取指标、营业状态、订单 Badge、拖放 announcement、库存 | 数字与标签成组；动态状态通过合适 live region 宣告 | Assisted |
| DASH-REC-08 | P1 | 390/430px 手机 | 浏览 Hero、metrics、URLs、orders、Widget 工具和日历 | 无页面横向溢出；按钮/QR/输入不被遮挡 | Assisted |
| DASH-REC-09 | P1 | 平板/桌面/200% zoom | 重复关键操作 | 两列正确降为一列；sticky/Popover/Dialog 可滚动可关闭 | Assisted |
| DASH-REC-10 | P2 | Reduced motion/high contrast/dark mode | 定制拖放、Badge、状态 Banner | 动画可减弱；焦点/状态/错误对比度可辨 | Assisted |
| DASH-REC-11 | P1 | 前端自动化 | 运行 DashboardCanvas/layout/Watched/page 相关测试 | 正常、失败、权限、并发和恢复有稳定断言 | Auto |
| DASH-REC-12 | P1 | 后端自动化 | 运行 summary、restaurant status、menu state、tenant tests | 关键权限/聚合/并发测试通过且无关键 skip | Auto |
| DASH-REC-13 | P1 | 测试结束 | 查询 DB/API/storage 并审查证据 | 餐厅/库存/schedule/watch/layout 恢复；截图无生产桌码、Token 或私人数据 | Auto |
| DASH-REC-14 | P1 | 公开 URL 构造 | 核对 Dashboard 生成的 public/table URL 与后端桌码来源 | URL base 来自配置而非硬编码；除 qrToken 外不携带内部 ID/参数；QR 内容与 Copy/Open 三者完全一致 | Auto |

## 12. 推荐执行顺序

1. `DASH-PRE-*`、`DASH-ROLE-*`，先确认身份和租户边界。
2. 只读的 `DASH-SUM-*`、`DASH-ORD-*`、`DASH-URL-*`。
3. 不影响业务数据的 `DASH-LAYOUT-*`。
4. 使用专用餐厅执行 `DASH-OPS-*` 和 `DASH-WATCH-*`，每个子组结束立即恢复。
5. 并发、故障、响应式、无障碍和最终清理。

## 13. 用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| QR | 用测试手机扫码指定 public/table QR | 解析 URL 与页面/数据库一致，不打开生产桌码 |
| Clipboard | 允许/拒绝一次剪贴板权限 | Copy 成功与失败提示均正确 |
| Touch drag | 在手机/触屏设备长按并拖动 Widget | 不误滚动/误触，保存后布局正确 |
| 响应式 | 手机 Safari/Chrome 与平板完成指定只读流程 | 无溢出、遮挡或焦点问题 |
| 营业影响 | 在明确测试餐厅观察暂停/恢复和公开菜单 | 接单状态在 Dashboard 与顾客页一致 |

## 14. 完成标准

- 所有被选 `DASH-*` 都记录为 PASS/FAIL/BLOCKED/NOT RUN；部分观察不能冒充 PASS。
- P0 租户隔离、多币种误导、越权写入、负库存/超卖任何一项失败都阻止 Dashboard 上线结论。
- 所有写操作的数据库/公开页面/审计与 UI 一致，并完成清理。
- 测试报告不含密码、Cookie、Access/Refresh Token、生产桌码或完整私人订单链接。
- 本包通过不代表支付、打印、备份或完整 release/full 验收通过。

