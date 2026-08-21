# DineFlow Dashboard 专项测试执行记录 — 2026-08-11

用例来源：[dashboard-test-cases.md](dashboard-test-cases.md)（本轮执行前补充了 15 条，共 122 条）  
分支 `jianda` · 提交 `af5ab89` · 工作区 dirty 218 个文件  
环境：Local Development —— API `localhost:5000`、前端 `localhost:5173`、PostgreSQL `localhost:5433`（均为 docker-compose 容器）  
执行方式：API + 数据库直查（phase1/phase2/phase2b 脚本）+ 浏览器实操（布局、角色视图、URL/QR）+ 前后端自动化测试

**结论：不建议以当前状态给 Dashboard 出上线结论。** 2 个 P0（多币种收入合并、布局跨账号泄露）和 4 个 P1（布局保存不持久、暂停到期后 Badge 反向、库存丢失更新、Watched 餐厅归属不明）需要先修。租户隔离、权限边界、营业配置与库存写入的正确性本身没有发现问题。

---

## 1. 汇总

| 分组 | 用例数 | PASS | FAIL | NOT RUN |
|---|---|---|---|---|
| 前置检查 DASH-PRE | 6 | 6 | 0 | 0 |
| 路由/角色/租户 DASH-ROLE | 12 | 10 | 1 | 1 |
| 加载/营业/指标 DASH-SUM | 17 | 10 | 4 | 3 |
| 最近订单 DASH-ORD | 10 | 8 | 0 | 2 |
| 公开 URL/桌码 DASH-URL | 13 | 8 | 0 | 5 |
| 营业配置 DASH-OPS | 17 | 11 | 1 | 5 |
| Watched/库存 DASH-WATCH | 19 | 15 | 2 | 2 |
| 布局定制 DASH-LAYOUT | 20 | 11 | 4 | 5 |
| 恢复/无障碍/质量 DASH-REC | 14 | 6 | 0 | 8 |
| **合计** | **122** | **85** | **12** | **25** |

NOT RUN 主要是文档标注为 `Assisted` 的项（扫码、剪贴板权限、鼠标/键盘/触屏拖放、屏幕阅读器、响应式与对比度）以及需要断网/注入失败的前端故障用例，已整理成第 4 节的接力清单。

---

## 2. 缺陷（按严重度）

可跟踪的问题清单见 [dashboard-issue-tracker-2026-08-11.csv](dashboard-issue-tracker-2026-08-11.csv)（`DASH-001`–`DASH-012`，含证据、建议动作与复测用例 ID）。本节是同一批问题的详细说明。

### P0-1 · 平台收入把多币种直接相加，并标成第一家餐厅的币种 — DASH-SUM-08

PlatformOwner 的 Paid 指标显示 **`A$2,054.50`**。该数字是后端 `AdminOrdersController.GetOrderSummary` 对全平台 Paid 订单 `sum(TotalAmount)` 的结果，实际由三种币种拼成：

| 币种 | Paid 收入 |
|---|---|
| AUD | 325.50 |
| INR | 616.00 |
| NPR | 1,113.00 |
| **被相加为** | **2,054.50** |

前端 `AdminDashboardPage.tsx:332` 的 `scopedCurrency` 取 `activeRestaurants[0].currency`，即按名称排序的首家 active 餐厅「Central Market Table」的 AUD，于是 `formatMoney` 把 NPR+INR 的钱当成澳元渲染。这是一个会被直接读成经营数字的错误值。

修复方向：后端按币种分组返回，前端分币种展示或明确标注"多币种未换算"。

### P0-2 · legacy 布局键无归属，跨账号泄露 — DASH-LAYOUT-20 / 18

`dashboardLayout.ts:114-115`：

```ts
const raw = window.localStorage.getItem(dashboardStorageKey(scope))
  ?? window.localStorage.getItem(legacyStorageKey)   // 'dineflow.dashboard.layout.v2'，无 scope
```

复现：浏览器中存在 A 账号留下的 v2 布局（`recent-orders` hidden）→ 登出 → B 账号（`admin.one.a`，userId `e6f9ac89…`，此前无自己的 v3 键）首次打开 `/admin` → B 的 Dashboard 直接套用 A 的布局，Recent orders 被隐藏，并把 A 的偏好写进 B 的 `v3.e6f9ac89…` 键固化下来。

只是布局偏好、不涉及业务数据，但违反"每用户隔离"的明确承诺，共用设备场景下会持续发生。修复方向：迁移时把 legacy 值绑定到写入者 userId，或迁移一次后立即删除 legacy 键。

### P1-1 · 保存的布局在刷新后被静默截断，schedule 类 Widget 的定制无法持久 — DASH-LAYOUT-12 / 19

干净复现（PlatformOwner）：

1. Customize → 隐藏 Opening hours 与 Special calendar → Save layout
2. localStorage 正确写入 5 条，两条 `hidden:true`
3. 刷新 `/admin`
4. **两个 Widget 又都显示出来**，且 localStorage 被覆写成只剩 2 条：`[public-urls, recent-orders]`

原因在 `DashboardCanvas.tsx`：初始 state 是首帧的 `reconcileLayout(widgets, loadStoredLayout(scope))`，而首帧 `AdminDashboardPage` 还在等 `getRestaurants()`，`canEditSchedule === false`，注册表里只有 2 个 Widget。reconcile 把另外 3 条当作"不存在的 id"丢弃，紧接着 `useEffect(() => saveLayout(scope, layout), [layout])` 把这份残缺布局写回存储。等餐厅加载完，3 个 Widget 以默认值重新追加。

连带结论（DASH-LAYOUT-19）：用户从未点过 Customize，存储里也已经躺着一份 2 条的布局快照。

修复方向：等 Widget 注册表稳定后再初始化/持久化，或只在用户显式 Save 时写存储。

### P1-2 · 暂停到期后 Dashboard 仍显示 Paused，与真实可下单状态相反 — DASH-OPS-17

把 R1 的 `AcceptingOrdersPausedUntil` 置为过去时间后：

| 数据源 | acceptingOrders |
|---|---|
| DB 原始列 | `false` |
| 公开下单接口 `/api/public/ordering/restaurants/{id}` | `true`（已恢复） |
| Staff `trading-status` 的 `availability.acceptingOrders` | `true` |
| Admin `/api/restaurant` 顶层 `acceptingOrders` | **`false`** |
| Admin `/api/restaurant` 的 `availability.acceptingOrders` | `true` |

可用性判定本身正确（按 `pausedUntil` 实时计算，不需要后台任务）。问题是 Dashboard 的 Accepting/Paused Badge 与 OrderingPauseControl 绑定的是顶层 `restaurant.acceptingOrders`（DB 原始值），所以暂停到期后后台会一直显示"已暂停"，而顾客其实已经能下单。应改用 `availability.acceptingOrders`。

### P1-3 · 库存 +/- 是绝对值写入，两端并发会丢失更新 — DASH-WATCH-18

`PATCH /api/admin/menu/items/{id}/stock` 接收绝对值且无版本校验/原子递增。Widget 的 +/- 按钮是"读本地值 → 算新值 → 写绝对值"。

实测：两个管理员各自读到 10，各点一次 Increase，两个请求都返回 200，最终库存 **11 而非 12**，一次加货被静默吞掉，界面没有任何冲突提示。

补充说明：反向操作（两端同时清零）不会出负库存，DB 的 `CK_MenuItems_StockQuantity` 约束和服务端 400 校验都有效（DASH-WATCH-07/13 PASS）。问题只在增量语义上。

修复方向：服务端提供原子 `increment/decrement`，或在请求里带上读到的旧值做乐观并发校验。

### P1-4 · Watched menu items 的餐厅归属在 PlatformOwner 下不可见 — DASH-WATCH-17

Widget 的 `restaurantId` 固定取 `primaryRestaurant`（按名称排序的首家 active 餐厅），而 Opening hours / Special calendar 面板有自己的餐厅选择器。PlatformOwner 在面板里切到 B 店后，Watched 仍是首家餐厅的菜品，卡片标题「Watched menu items」也没有点名餐厅——从界面上无法判断正在改哪家店的库存和上下架。

同一处的次级风险（DASH-WATCH-19）：`watched` 接口不返回 currency，价格用 Dashboard 的 `scopedCurrency` 渲染。目前两者恰好指向同一家餐厅所以显示正确，但这是巧合而非约束。

### P1-5 · Hero 的暂停控件作用于单店，紧邻的指标是全平台，两者无视觉分隔 — DASH-SUM-15

PlatformOwner 的 Hero 区从上到下依次是：状态 Banner（作用域＝首家 active 餐厅）→ `Close restaurant` 按钮（同上）→ 4 个指标（作用域＝全平台 113 单 / 12 家餐厅）。

状态 Banner 本身是点名了餐厅的（实测显示「Central Market Table · Closed now」），这点比预期好。问题出在下面的 OrderingPauseControl：文案只有「Close when the kitchen is overloaded. Opening hours still apply automatically.」，没有任何餐厅名，而它上面是单店状态、下面是平台总量。一个管着 12 家店的 PlatformOwner 很容易把这个按钮读成"暂停平台接单"，实际点下去只会停掉按名称排序的第一家店。

原用例定级 P0，实测因 Banner 已点名餐厅，降为 P1。修复方向：给 Pause 控件补上餐厅名，或给指标区补上"平台全量"的作用域标注。

### P2-1 · Refresh 无重入保护，快速双击触发两次加载两次提示 — DASH-SUM-11

MutationObserver 实测：点击后按钮在 **71ms** 才进入 `Refreshing`/disabled，持续约 86ms。在这 71ms 窗口内的第二次点击不会被拦截——双击后确实发出两轮请求并弹出两条 `Dashboard refreshed`。`disabled={loading}` 只是渲染后的保护，不是同步的在途守卫。

### P2-2 · 加载失败时 4 个指标仍渲染成 0，与"真的没有订单"无法区分 — DASH-ROLE-12 / DASH-SUM-13

把一个 Admin 的 `RestaurantId` 临时置空后打开 `/admin`：页面顶部正确显示简短错误 `Current user is not assigned to a restaurant.`（无堆栈、无 SQL、无内部地址），但下方 4 个指标照常渲染 `0 / 0 / 0 A$0.00 / 0`，币种还回退到了 AUD。同时弹出两条完全相同的错误 toast。

失败态应当把指标置为空态而不是 0。

### P2-3 · 特殊日历并发保存是 last-write-wins，无冲突提示 — DASH-OPS-16（WARN）

两个管理员并发 PUT `special-days`，两个请求都返回 200，最终留下其中一份完整快照（没有出现混合的局部写入，这点是好的），但先保存的一方整份日历被静默覆盖，界面无法察觉。营业时间保存同理。

---

## 3. 通过项中值得记录的证据

**租户隔离（P0 组全部通过）**
- Admin/Owner A 用 B 店 id 调用 `tables` / `watched` / `ordering-status` / `opening-hours` / `special-days` / `availability` / `stock` / `watch` 共 7 个读写接口，全部 403；B 店菜品的 `IsAvailable/StockQuantity/IsWatched` 前后逐字段比对无变化。
- Admin A 用 B 店订单 id 读 `status-history` 返回 403，响应体不含订单号。
- `summary?restaurantId=<B>` 返回全 0 而非 B 的数据，也不暴露 B 是否存在。
- Staff：`restaurants` / `watched` / `tables` / `ordering-status` 全 403，只保留只读 `trading-status`；UI 上只有 2 个 Widget、无 Payments 链接、`Process soon` 全部 disabled。
- Customer 打开 `/admin` 得到 Access denied 页，无订单号、无桌码 token 泄露。

**指标与 DB 交叉核对（Admin A / R1）**

| 指标 | UI | API | DB |
|---|---|---|---|
| Orders | 46 | 46 | 46 |
| Kitchen active | 28 | 28 | 28（Status 0–3） |
| Paid | 6 · NPR 1,113.00 | 6 / 1113.00 | 6 / 1113.00 |
| Awaiting payment | 5 · 19 payable | 5 / 19 | 5 / 19 |

退款与失败支付合计 4,152.50 未计入收入。列表只取最新 5 条而 `totalItems=46`，汇总用的是全量范围。

**营业配置**
- 15/30/60/120 分钟暂停：`pausedUntil` 误差 ≤1 分钟，公开下单接口同步返回 `acceptingOrders:false`。
- Pause until next opening 按餐厅时区（Asia/Kathmandu）解析到下一个营业窗口。
- 四种 availability 的 reason 互相区分：`Open` / `Closed` / `Paused` / `Inactive`。
- 时区正确：浏览器 UTC+9:30 时，`availability.localNow` 为 Kathmandu 的 22:5x，UI 显示「restaurant time 22:55」。
- 校验完整：重叠窗口、零长度窗口、非法 JSON、非法 dayOfWeek、非法时间、重复特殊日期、营业但无 window —— 全部 400 拒绝且无部分保存；跨夜 18:00–02:00、午休分段、24h（00:00–00:00）、closed day、闰日 2028-02-29 全部正确接受。
- 特殊日覆盖周计划验证有效：周计划设 24h 时 `isWithinOpeningHours=true`，把今天设成 Closed override 后变为 `false`。

**库存与上下架**
- available off → DB `false` 且公开菜单不再返回该菜品；on → 恢复。
- stock 1→0 → `isSoldOut` 自动 true，公开菜单保留菜品但带 sold-out 标记；Increase 回 1 后 `isSoldOut` 自动 false。
- 负库存 400 拒绝，DB 保持 0。
- Stop tracking → `stockQuantity=null`，`isAvailable` 未被误改。
- Stop watching 只移出列表，菜品 4 个字段逐一比对无变化。
- 审计只记录成功操作（`MenuItem.AvailabilityChanged` / `StockChanged` / `WatchChanged`、`Restaurant.OrderingPaused` / `OrderingResumed`），400/403/404 不产生条目。

**公开 URL 与桌码**
- PlatformOwner 的 URL Widget 按名称排序取前 4 家 active，2 家 inactive 被排除。
- 桌码列表：7 张桌台中 6 张 active+有 qrToken 被列出，1 张 inactive 被过滤；URL 只携带 qrToken，不含 restaurantId 等内部 ID。
- QR 弹窗里的 `<code>` 与列表行 URL、Open 的 href 三者逐字符一致；`target="_blank" rel="noreferrer"`。
- 无可用桌台时显示明确空态，不会无限 Loading。

**布局定制（除上述缺陷外）**
- 无 storage 时按注册表顺序 + 每个 Widget 第一个 allowed size 渲染。
- 未点 Customize 时页面上 0 个布局控件。
- Move earlier/later 只改顺序不改尺寸，首尾按钮正确 disabled。
- 尺寸下拉只列出该 Widget 的 allowedSizes（Recent orders：1x1 / 1x2 / 2x1）。
- 隐藏/恢复/全部隐藏都正确，全隐藏时有恢复空态。
- Undo 逐步回退草稿，到底后按钮 disabled；Cancel 全部丢弃且不写 storage；Default 只改草稿；保存 Toast 的 Undo 能恢复并持久化上一版布局。
- 存储键按 userId 隔离（owner `39d19b63…` / admin `e6f9ac89…` / staff `632cf7e9…` 各一份）。
- 损坏的 JSON 回退到默认布局，页面可用且不显示堆栈。

**自动化测试**
- 前端：49 个文件 413 个测试全部通过。
- 后端：418 通过 / 4 跳过（跳过的是 `CounterReversalConcurrencyTests` 与 `MfaSettingsConcurrencyTests`，属支付与 MFA 并发，与 Dashboard 无关）。首次执行时报的 396 来自一份过期的增量构建产物，强制重建后的实际基线是 418。
- 环境备注：本机只装了 .NET 10 SDK，`dotnet test` 需要 `DOTNET_ROLL_FORWARD=Major` 才能跑 net8.0 测试宿主。
- 覆盖缺口：`dashboardLayout` 的单测覆盖了 reconcile 的丢弃/追加/clamp/去重，但**没有覆盖本轮发现的挂载时截断回写**，也没有覆盖 `loadStoredLayout` 的损坏输入与 legacy 迁移。建议补三条回归测试。

---

## 4. 需要接力的用例

以下需要真实设备、人工权限授权或前端故障注入，我这边无法可靠完成：

| 用例 | 需要你做的 | 我随后核对 |
|---|---|---|
| DASH-URL-05 | 点一次 public URL 的 Copy 并允许剪贴板权限，再拒绝一次重试 | 成功内容是否与页面 code 完全一致；失败是否只有短提示且页面仍可用 |
| DASH-URL-06 | 用手机扫 `/table/…` 的 QR（本地地址，非生产桌码） | 扫出的 URL 与页面 code 是否一致 |
| DASH-URL-06 / REC-06 | 用键盘 Tab 到 QR 按钮、Enter 打开、Esc 关闭 | 焦点是否回到 QR 按钮、有无焦点陷阱（我用合成事件和浏览器面板都没能让 Esc 关闭弹窗，需要真实键盘确认是实现问题还是我的环境问题） |
| DASH-LAYOUT-04/05/06 | 鼠标拖拽、键盘 Space+方向键、手机长按拖动各排一次 | 保存后顺序是否正确、有无误滚动/误触 |
| DASH-REC-07/08/09/10 | 屏幕阅读器读一遍指标与状态；390/430px 手机与平板各走一遍只读流程；开 reduced motion / 高对比度 | 有无横向溢出、遮挡、对比度不足 |
| DASH-SUM-12/13、OPS-06、WATCH-12（前端侧）、URL-11 | 断网或用 DevTools 拦截让某个接口 500，再点 Refresh / Pause / 库存 +/- / 展开桌码 | UI 是否回滚到服务器状态、按钮是否恢复、有无假成功 |
| DASH-SUM-06 | 需要一个订单数为 0 的餐厅并给它挂一个 Admin 账号（现有 12 家餐厅都有订单） | 全 0 指标与空态的币种格式是否正确 |
| DASH-ROLE-09 | 说明一下会话失效策略（角色被移除后旧 token 是否应立即失效） | 按策略验证旧页面刷新后的行为 |

另有 DASH-SUM-07（大数/小数边界）、SUM-14（加载中切账号）、ORD-09（实时到达）、OPS-10/12/15（草稿丢弃与切店防护）、WATCH-14（菜单页并发编辑）、URL-13（桌台缓存）、LAYOUT-15（角色变化后 Widget 取舍）、REC-01/02 未执行，可按需要单独排一轮。

---

## 5. 数据还原

所有写操作都在 R1「The DineFlow Kitchen」和 3 个测试菜品上进行，收尾逐项比对：

| 对象 | 状态 |
|---|---|
| R1 的 `IsActive` / `AcceptingOrders` / `AcceptingOrdersPausedUntil` / `OpeningHoursJson` / `SpecialOpeningDaysJson` | 已还原（`t` / `t` / `null` / 09:00–21:00 × 7 / `[]`） |
| 全库 `IsWatched` | 0（与基线一致） |
| 全库 `StockQuantity` 非空 | 0（与基线一致） |
| 全库 `IsAvailable=false` / `IsSoldOut=true` | 7 / 5（与 `menu_baseline.csv` 一致） |
| `admin.one.b` 的 `RestaurantId`、`staff.one.d` 的角色 | 已还原 |
| 浏览器 localStorage | 测试期间新建的布局键已删除，PlatformOwner 的原布局已写回；auth token 已清除，恢复未登录状态 |

基线快照留在容器内 `/tmp/rest_baseline.csv` 与 `/tmp/menu_baseline.csv`。本记录不含任何密码、Cookie、Access/Refresh Token 或生产桌码。
