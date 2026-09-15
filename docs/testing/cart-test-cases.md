# DineFlow 购物车专项测试用例

测试包名称：`cart`  
稳定用例前缀：`CART-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `cart`、某个 `CART-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖公开菜单中的购物车抽屉、共享桌台购物车、购物车 Session、商品与选项、价格和库存重算、订单备注、实时同步、购物车提交以及提交后向 `/checkout`、`/my-orders`、`/staff/orders`、`/staff/front-counter` 和 `/admin/orders` 的交接。

购物车目前不是独立 `/cart` 路由，而是以下页面中的底部抽屉：

- 餐厅入口：`/r/{restaurantId}/menu?orderType=DineIn|Takeaway`
- 桌码入口：`/table/{qrToken}`

相邻专项包的职责边界：

- 本包验证“订单由购物车生成后，是否完整、唯一、及时地进入相邻页面”。
- `/my-orders` 的完整搜索、筛选、分页、取消、退款和 Reorder 矩阵由后续 `my-orders` 包负责。
- `/staff/orders` 的厨房状态机、声音、实时队列和并发矩阵由后续 `staff-orders` 包负责。
- `/staff/front-counter` 的桌台、柜台收款、合并账单与交班矩阵由 [Front Counter 专项](front-counter-test-cases.md) 负责。
- `/admin/orders` 的管理端矩阵见 [admin-orders-test-cases.md](admin-orders-test-cases.md)。

## 1. 执行与安全规则

- 写操作只在 Local/Test/Staging 执行；Production 默认只读。
- 过期测试优先在测试数据库精确调整 `Carts.ExpiresAt`，不得真实等待 8/24 小时；每次记录原值并在结束后恢复或删除本轮夹具。
- 并发与最后库存测试必须使用一次性菜品、一次性购物车和可恢复库存，不碰真实营业库存。
- Checkout 会创建订单、占用库存并触发实时通知、声音和打印；执行前把打印目标切到测试队列。
- Stripe 只允许 Sandbox；本包默认止于 Checkout 页面，不自动完成真实或测试扣款，除非同时明确选择 [Payment System 专项](payment-system-test-cases.md)（`payment-system` / `stripe-payment`）。
- 截图和报告不得包含完整 `participantToken`、Guest Access Token、JWT、桌码 QR Token、顾客完整邮箱/电话或完整 Stripe 标识。
- `sessionStorage`、登录 Session 和服务端 Cart 是三层不同状态，任何一个失败都必须分别记录，不得统称为“Session 问题”。
- 用数据库造临界时间、分页边界或库存竞争只允许精确修改本轮测试记录，并写入 cleanup 日志。

## 2. 当前实现基线

| 项目 | 当前约定 | 测试重点 |
|---|---|---|
| Takeaway Cart lifetime | 24 小时 | 24h 前、临界点、过期后 |
| Dine-in Cart lifetime | 8 小时 | 桌台共享、桌台 Session、过期后重扫 |
| 浏览器保存位置 | `sessionStorage` | 每标签页、关闭标签、损坏/缺失记录 |
| 餐厅 Key | `dineflow.customer-cart.restaurant:{restaurantId}:{ordertype}` | DineIn/Takeaway 必须隔离 |
| 桌码 Key | `dineflow.customer-cart.table:{qrToken}` | 不得在报告泄露完整 QR Token |
| Cart 鉴权 | `X-Cart-Participant-Token` | 与登录 JWT 独立，错误 Token 不可枚举 |
| Item quantity | 1–100 | 0、负数、100、101、并发累计 |
| Item note | UI 180 字；API 2000 字 | UI/API 边界与安全显示 |
| Order note | 4000 字 | 未保存提醒、空白归一化、结账快照 |
| 法律版本 | Terms、Privacy、Allergen Notice 当前版本 | 缺失、旧版本、错误版本必须拒绝 |
| Cart status | Active / Submitted / Expired | 只允许 Active 修改；Submitted 幂等恢复 |

## 3. 推荐账号、夹具与时钟

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| Guest A/B | 两个隔离浏览器上下文 | Token、共享购物车、Guest order |
| Customer A/B | 已确认账号，A/B 不同 | 登录绑定、My Orders、隐私隔离 |
| Staff A/B | 同店两个会话 | Staff Orders / Front Counter 交接与实时 |
| Staff B tenant | 另一餐厅 | 租户隔离 |
| Admin/Owner A | 餐厅 A | 后台订单核对 |
| 餐厅 A | 同时支持 DineIn/Takeaway、Pay at counter、Stripe Sandbox | 主流程 |
| 餐厅 B | 不同币种/时区 | 跨店、币种和隔离 |
| 餐厅 C | 暂停/打烊/Stripe 未就绪 | 可用性负向场景 |
| 桌台 T1/T2 | 有效 QR；T2 可停用 | 桌码与 Table Session |
| 菜品矩阵 | 普通、最后库存、Sold out、隐藏、含必选/可重复选项、含过敏原 | 重算与校验 |
| 大购物车 | 至少 35 行、总数量 >100、长名称/备注 | 滚动、性能、可访问性 |
| 可控时钟/DB | 能精确设置 `ExpiresAt`、菜单价格、库存和订单创建时间 | 临界与分页 |
| 测试打印队列 | 不连接真实厨房 | 订单创建副作用 |

## 4. 前置检查（10）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-PRE-01 | P1 | 项目目录 | 记录环境、分支、提交、dirty 数量和服务地址 | 明确不是误用 Production | Auto |
| CART-PRE-02 | P1 | 数据库 | 记录服务器 UTC、数据库 UTC 与浏览器时区 | 临界时间计算有可复核基线 | Auto |
| CART-PRE-03 | P1 | 账号 | 解析 Customer/Staff/Admin 的 userId、role、restaurantId | 角色与租户明确 | Auto |
| CART-PRE-04 | P1 | 餐厅 | 记录营业、暂停、支付政策、币种、时区与可用订单类型 | 后续预期不靠猜测 | Auto |
| CART-PRE-05 | P1 | 菜单 | 导出测试菜品价格、库存、选项、过敏原与可用状态 | 可核对并恢复 | Auto |
| CART-PRE-06 | P1 | 桌台 | 确认 T1/T2 归属、active 状态和当前 Table Session | 不误加入真实桌台 | Auto |
| CART-PRE-07 | P1 | 浏览器 | 准备 Guest A/B、Customer A、双标签与移动 viewport | Session/并发可隔离 | Auto |
| CART-PRE-08 | P1 | 打印/通知 | 将打印设为测试队列并记录通知基线 | 创建订单不影响真实厨房 | Assisted |
| CART-PRE-09 | P1 | 一次性数据 | 建立本轮 cart/order/item ID 登记表 | 每次写入可追踪、可清理 | Auto |
| CART-PRE-10 | P1 | API | 确认可记录响应状态但会遮蔽 Token | 证据不泄露凭证 | Auto |

## 5. 入口、餐厅、桌台与订单类型（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-ENTRY-01 | P1 | Guest | 打开有效 Takeaway 深链 | 菜单与 Takeaway cart 就绪；币种/餐厅正确 | Auto |
| CART-ENTRY-02 | P1 | Guest | 打开有效 DineIn 深链 | Dine-in cart 就绪；无虚构桌号 | Auto |
| CART-ENTRY-03 | P1 | Guest | 打开有效桌码 | 强制 DineIn；显示正确桌号 | Auto |
| CART-ENTRY-04 | P1 | 餐厅同时支持两种类型 | 不带 `orderType` 打开 | 先选择类型，不静默猜测 | Auto |
| CART-ENTRY-05 | P1 | 仅 Takeaway | 请求 DineIn | 回落到选择/明确不支持；不创建错误 Cart | Auto |
| CART-ENTRY-06 | P1 | 仅 DineIn | 请求 Takeaway | 同上 | Auto |
| CART-ENTRY-07 | P1 | 非法参数 | `orderType=delivery`、空值、大小写混合 | 非法值不创建第三种类型；合法大小写归一 | Auto |
| CART-ENTRY-08 | P1 | 有空 Cart | DineIn ↔ Takeaway | 切换成功；各自使用独立 Cart Key | Auto |
| CART-ENTRY-09 | P1 | 有商品 Cart | 请求切换类型，点 Cancel | 留在原类型；商品和金额不变 | Auto |
| CART-ENTRY-10 | P1 | 有商品 Cart | 请求切换并 Confirm | 新类型 Cart 正确；旧 Cart 不被悄悄清空或混入 | Auto |
| CART-ENTRY-11 | P0 | 餐厅 A Cart | 通过前端/API 加餐厅 B 商品 | 拒绝；Cart 仍只含 A 的商品 | Auto |
| CART-ENTRY-12 | P1 | 无 restaurantId/qrToken | 打开畸形菜单 URL | 可读错误；不请求随机 Cart | Auto |
| CART-ENTRY-13 | P1 | 不存在餐厅 | 打开入口 | 404/不可用；无餐厅枚举细节 | Auto |
| CART-ENTRY-14 | P1 | 已停用餐厅 | 打开入口 | 不允许新 Cart；原因可读 | Auto |
| CART-ENTRY-15 | P1 | 已暂停/打烊餐厅 | 打开入口 | 菜单可按策略浏览，但不可启动/修改/结账 | Auto |
| CART-ENTRY-16 | P0 | T2 已停用 | 扫旧桌码 | 拒绝；不创建 Table Session 或 Cart | Auto |
| CART-ENTRY-17 | P0 | 餐厅 A 的 Cart + T2/B token | 混用 restaurantId/tableQrToken 或错误餐厅桌码 | 400/404；上下文不可串换 | Auto |
| CART-ENTRY-18 | P1 | 同一餐厅不同币种夹具 | 依次进入 A/B 菜单 | 每个 Cart 只用所属餐厅币种和格式 | Auto |

## 6. Cart Session、Token、登录状态与过期（28）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-SES-01 | P1 | Active Cart | 同标签刷新 | 恢复同一 cartId、商品、备注与 participant | Auto |
| CART-SES-02 | P1 | Active Cart | 菜单→法律页→浏览器返回 | 恢复同一 Cart，不重复 Join | Auto |
| CART-SES-03 | P1 | Active Cart | 关闭抽屉再打开 | UI 状态与服务端一致 | Auto |
| CART-SES-04 | P1 | Active Restaurant Cart | 新开普通标签访问同入口 | 按 `sessionStorage` 规则建立独立 Cart；不泄露旧 Token | Auto |
| CART-SES-05 | P1 | Active Restaurant Cart | Duplicate tab 后分别修改 | 明确实际继承规则；任何继承 Token 的标签实时一致，无丢写 | Assisted |
| CART-SES-06 | P1 | Active Cart | 完全关闭标签再重开入口 | `sessionStorage` 已消失时安全新建；旧 Cart 不被猜中 | Assisted |
| CART-SES-07 | P1 | Active Cart | 浏览器刷新前删掉该 storage key | 创建新 Cart；旧商品不错误显示 | Auto |
| CART-SES-08 | P1 | storage | 写入损坏 JSON 后刷新 | 忽略损坏记录并安全 Join；无白屏 | Auto |
| CART-SES-09 | P1 | storage | 缺 cartId/token/participantId 任一字段 | 视为无效；不得发送 `undefined` Token | Auto |
| CART-SES-10 | P0 | Active Cart | 使用缺失 Token GET/PUT/DELETE/checkout | 401；不返回 Cart 内容，不修改 | Auto |
| CART-SES-11 | P0 | Active Cart | 使用随机正确长度 Token | 同样通用 401；不可判断 cart 是否存在 | Auto |
| CART-SES-12 | P0 | Cart A/Token B | 交叉组合 GET/修改/checkout | 拒绝；A/B 均不改变 | Auto |
| CART-SES-13 | P1 | 不存在 cartId | 正确格式 Token 请求 | 404，不含堆栈/SQL | Auto |
| CART-SES-14 | P1 | Customer A 已登录 | Join、刷新、checkout | 订单绑定 A；不生成 Guest token | Auto |
| CART-SES-15 | P0 | Guest Cart 已有商品 | 登录 Customer A 后继续同 Cart | participant 安全绑定 A；订单进入 A 的 My Orders | Auto |
| CART-SES-16 | P0 | Customer A Cart | 登出后继续购物并 checkout | 明确要求重新登录或明确转 Guest；不得悄悄改变订单所有者 | Assisted |
| CART-SES-17 | P0 | Customer A Cart | Access JWT 到期但 refresh 可用时修改/checkout | 自动刷新并仍绑定 A；不降级成 Guest | Auto |
| CART-SES-18 | P0 | Customer A Cart | Access/refresh 均失效时 checkout | 先提示 Session expired 并要求登录；Cart 保留；不生成孤儿 Guest order | Auto |
| CART-SES-19 | P1 | 登录 Session 失效 | 重新登录 A | 原 Cart 可恢复且只绑定 A | Assisted |
| CART-SES-20 | P0 | A Cart | Session 失效后改登录 Customer B | 明确确认所有权切换或新 Cart；不得把 A 的敏感备注静默归到 B | Assisted |
| CART-SES-21 | P1 | Takeaway Cart | 检查创建时 expiresAt | 接近 server UTC +24h；误差在允许范围 | Auto |
| CART-SES-22 | P1 | DineIn Cart | 检查创建时 expiresAt | 接近 server UTC +8h | Auto |
| CART-SES-23 | P1 | expiresAt 还有 10 分钟 | 打开/修改 Cart | 可继续；页面明确剩余时间或即将过期提醒 | Auto |
| CART-SES-24 | P1 | expiresAt 还有 60 秒 | 保持页面并跨过临界点 | 到期前操作按服务器时间决定；到期后立即变只读/过期 | Auto |
| CART-SES-25 | P0 | expiresAt 前 1 秒 | 同时发 Update 与 Checkout | 以事务/服务器时间为准；最多一个合法结果，无半提交 | Auto |
| CART-SES-26 | P0 | expiresAt 已过 | GET、Add、Update、Delete、Checkout | 410 Cart expired；数据库状态变 Expired；无订单/库存占用 | Auto |
| CART-SES-27 | P1 | 过期 Cart storage 仍在 | 刷新入口 | 移除旧 storage 并创建新 Active Cart；旧商品不复制 | Auto |
| CART-SES-28 | P1 | 浏览器时钟快/慢 2 小时 | 打开临近过期 Cart | 以服务端 UTC 为准；浏览器时钟不能绕过或提前失效 | Auto |

## 7. 抽屉、布局与基础交互（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-UI-01 | P1 | 空 Cart | 打开抽屉 | 明确空状态；Checkout disabled | Auto |
| CART-UI-02 | P1 | 1 个商品 | 检查底栏 | 数量、币种、总额与抽屉一致 | Auto |
| CART-UI-03 | P1 | 多商品 | 展开/折叠多次 | 不丢滚动外的行；底栏不跳动遮挡 | Auto |
| CART-UI-04 | P1 | 35 行大 Cart | 滚到首/尾、修改中间行 | 抽屉内部可滚动；Header/Total/Checkout 可到达 | Auto |
| CART-UI-05 | P1 | 长商品/选项名 | 查看一行 | 换行不覆盖价格/数量按钮 | Auto |
| CART-UI-06 | P1 | 大金额/非 AUD | 查看底栏与总计 | 不截断，不错误显示 A$ | Auto |
| CART-UI-07 | P1 | 加载中 | 连点 Add/+/Clear/Checkout | 控件有 loading/disabled；不会重复提交 | Auto |
| CART-UI-08 | P1 | API 失败 | 执行任一 Cart 操作 | 保留服务器已知状态；短错误；不清空 Cart | Auto |
| CART-UI-09 | P1 | 失败后重试 | 恢复 API 再操作 | 可成功；不需刷新整页 | Auto |
| CART-UI-10 | P1 | Submitted/Expired Cart | 打开抽屉 | 明确只读；所有修改入口禁用 | Auto |
| CART-UI-11 | P1 | Clear Cart | 点 Clear → Keep cart | 对话框关闭；内容不变 | Auto |
| CART-UI-12 | P1 | Clear Cart | 点 Clear → Clear cart | 所有行移除；总数/总额归零；只请求一次 | Auto |
| CART-UI-13 | P1 | 空 Cart | 直接调用 Clear API 两次 | 幂等返回空 Cart | Auto |
| CART-UI-14 | P2 | Slow 3G | 打开/修改 | 骨架与按钮状态稳定，无重复 Toast 风暴 | Assisted |
| CART-UI-15 | P1 | Dark theme | 展开 Cart、错误、确认框 | 对比度和危险操作可辨 | Assisted |
| CART-UI-16 | P1 | 浏览器后退/前进 | Cart 开关与菜单路由切换 | 路由历史合理，不生成额外 Cart | Auto |

## 8. 商品增删改、合并与输入边界（27）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-ITEM-01 | P1 | 普通菜品 | 加 1 件 | 新行、数量 1、价格正确 | Auto |
| CART-ITEM-02 | P1 | 同商品/同选项/同备注 | 再加同一组合 | 合并同一行，数量累加 | Auto |
| CART-ITEM-03 | P1 | 同商品/不同备注 | 分别加入 | 保持两行 | Auto |
| CART-ITEM-04 | P1 | 同商品/不同选项 | 分别加入 | 保持两行，各自价格正确 | Auto |
| CART-ITEM-05 | P1 | 两行后来改成完全相同 | 修改其中一行 | 自动合并；总量/总价守恒 | Auto |
| CART-ITEM-06 | P1 | Quantity | 1→2→100 | 每步成功且总数/总额同步 | Auto |
| CART-ITEM-07 | P0 | Quantity | UI/API 尝试 0、-1、101、极大整数 | 拒绝；原数量不变；无溢出 | Auto |
| CART-ITEM-08 | P1 | Quantity | 直接传小数、字符串、null | 400；无隐式错误取整 | Auto |
| CART-ITEM-09 | P0 | 合并数量 | 60 行与 50 行合并 | 因总量 110 拒绝；两行原样保留 | Auto |
| CART-ITEM-10 | P1 | 删除单行 | 删除并撤销浏览器返回 | 行只删除一次；返回不复活 | Auto |
| CART-ITEM-11 | P1 | 删除最后一行 | 删除 | 空状态、0 项、0 金额 | Auto |
| CART-ITEM-12 | P1 | 已被别人删除的行 | 当前标签再次删除/修改 | 404/冲突后刷新最新 Cart；不白屏 | Auto |
| CART-ITEM-13 | P0 | Cart A | 用 A 的 Token 修改属于 Cart B 的 itemId | 404；B 不改变 | Auto |
| CART-ITEM-14 | P0 | 菜品 B | 伪造 menuItemId 加入 A | 409；无跨餐厅行 | Auto |
| CART-ITEM-15 | P1 | 不存在菜品 | 伪造 ID | 409/可读 unavailable | Auto |
| CART-ITEM-16 | P1 | Sold out/hidden/category inactive | 从旧页面或 API 加入 | 拒绝；Cart 不变 | Auto |
| CART-ITEM-17 | P1 | 菜品刚被删除 | Cart GET | 行显示 unavailable 或要求处理；不 500 | Auto |
| CART-ITEM-18 | P1 | Item note UI | 输入 179、180、181 字符 | 180 可保存；181 UI 阻止并显示计数/说明 | Auto |
| CART-ITEM-19 | P1 | Item note API | 输入 2000、2001 字符 | 2000 可接受；2001 明确拒绝 | Auto |
| CART-ITEM-20 | P1 | Item note | 前后空格/全空白 | Trim；全空白保存为 null | Auto |
| CART-ITEM-21 | P0 | Item note | 输入 HTML/script/Markdown/SQL-like 文本 | 按纯文本显示；不执行、不破布局 | Auto |
| CART-ITEM-22 | P1 | Unicode note | Emoji、中日韩、组合字符、换行 | 不乱码；长度规则一致且可打印 | Assisted |
| CART-ITEM-23 | P1 | 快速 + | 连点 10 次 | 最终数量与成功请求数一致；不丢增量 | Auto |
| CART-ITEM-24 | P0 | 双标签 | A/B 同时改同一行数量 | 不静默覆盖；最终值可解释并同步到两端 | Assisted |
| CART-ITEM-25 | P1 | 修改弹窗 | 修改后 Cancel | 行、选项、备注不变 | Auto |
| CART-ITEM-26 | P1 | 修改弹窗 | Save 时断网 | 弹窗/Cart 保留原值并允许重试 | Auto |
| CART-ITEM-27 | P1 | 大 Cart | 混合增加、合并、删除后核对 | itemCount 是数量和；items.length 是行数；不混淆 | Auto |

## 9. 选项、定价、币种与过敏原（22）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-OPT-01 | P1 | 无选项菜品 | 加入 | unit=base；line=quantity×base | Auto |
| CART-OPT-02 | P1 | 必选组 | 不选直接 Add | UI 和 API 都拒绝 | Auto |
| CART-OPT-03 | P1 | min/max 组 | 分别低于 min、等于边界、超过 max | 仅合法数量成功 | Auto |
| CART-OPT-04 | P1 | 单选组 | 切换选项 | 旧选项被替换，不同时保留 | Auto |
| CART-OPT-05 | P1 | 可重复 option | 0、1、max 次 | 数量、标签和加价正确 | Auto |
| CART-OPT-06 | P0 | 重复 ID | API 重复提交 optionId 超过 max | 按重复次数校验并拒绝超限 | Auto |
| CART-OPT-07 | P0 | 外组/外菜品 optionId | 伪造选择 | 拒绝；不能借外部 ID 改价 | Auto |
| CART-OPT-08 | P1 | 已停用 option/group | 旧 Cart 修改/checkout | 重校验并解释受影响商品 | Auto |
| CART-OPT-09 | P1 | option price ± | 加正价、零价、允许的负调整 | unit/line/total 与规则一致，不为负 | Auto |
| CART-OPT-10 | P0 | 精度 | 0.1/0.2、三位小数来源、数量 100 | 前后端统一到币种精度，无浮点尾差 | Auto |
| CART-OPT-11 | P1 | AUD/NPR/INR | 同样组合加入不同餐厅 | 使用各自币种与 minor unit；不混 A$ | Auto |
| CART-OPT-12 | P1 | 菜单基础价格改变 | Cart 打开时刷新/轮询 | Cart 采用最新价并明确提示价格变化 | Assisted |
| CART-OPT-13 | P1 | option 价格改变 | 同上 | 选项价与总计同步；旧 UI 不继续提交旧总额 | Assisted |
| CART-OPT-14 | P0 | 价格在 Checkout 瞬间改变 | 并发改价并提交 | 订单按服务端最终校验价格；顾客可见且不会被静默多收 | Auto |
| CART-OPT-15 | P1 | 商品过敏原 | 加入并展开 Cart | 可在结账前方便查看或链接到完整声明 | Auto |
| CART-OPT-16 | P1 | option 过敏原 | 加含 allergen/may contain/cross-contact 的 option | 每层声明可辨，不被菜品声明覆盖 | Auto |
| CART-OPT-17 | P1 | 过敏原更新 | Cart 尚未提交时后台更新 | Cart 显示当前声明；Checkout 快照为提交时声明 | Auto |
| CART-OPT-18 | P0 | option 被移除 | 旧 Cart Checkout | 拒绝 invalid options；不创建删减后的错误订单 | Auto |
| CART-OPT-19 | P1 | 长选项清单 | 20+ selected option entries | 抽屉可读/可滚动；价格不被挤掉 | Auto |
| CART-OPT-20 | P1 | 同名 option 不同组 | 加入 | 显示 Group + Option，避免歧义 | Auto |
| CART-OPT-21 | P1 | 总额复算 | 多行、多数量、多 options | UI Cart、Cart API、Checkout 订单逐分一致 | Auto |
| CART-OPT-22 | P0 | 负价格攻击 | 伪造负 quantity/不存在 adjustment | 后端忽略客户端价格，只按服务端菜单计算 | Auto |

## 10. Order note、法律同意与敏感信息（15）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-NOTE-01 | P1 | Order note | 输入并 Save | 成功保存，刷新仍在 | Auto |
| CART-NOTE-02 | P1 | 已有 note | 修改但不保存，点 Checkout | 出现 Continue without saving 对话框 | Auto |
| CART-NOTE-03 | P1 | 未保存对话框 | Go back and save | 留在 Cart；订单未创建 | Auto |
| CART-NOTE-04 | P1 | 未保存对话框 | Checkout anyway | 只提交上次已保存 note；明确不包含草稿 | Auto |
| CART-NOTE-05 | P1 | 已保存 note | 清空并保存 | 服务端保存 null；订单不带旧 note | Auto |
| CART-NOTE-06 | P1 | 边界 | 3999、4000、4001 字符 | 4000 成功；4001 UI/API 拒绝 | Auto |
| CART-NOTE-07 | P0 | 文本安全 | HTML/script、URL、SQL-like、RTL、Emoji | 纯文本展示/打印；不执行、不破布局 | Assisted |
| CART-NOTE-08 | P1 | Allergy preset | 添加同一 preset 两次 | 不重复追加；用户可继续编辑 | Auto |
| CART-NOTE-09 | P1 | 敏感健康信息 | 输入过敏/健康备注 | 显示用途/接收者/保留提醒；只收履约所需 | Auto |
| CART-LEGAL-01 | P1 | Cart 底部 | 打开 Terms/Privacy/Allergen | 新标签可达、版本一致、Cart 保留 | Auto |
| CART-LEGAL-02 | P0 | API | 缺任一法律版本 Checkout | 400；列出当前要求；无订单 | Auto |
| CART-LEGAL-03 | P0 | API | 传旧/未知/大小写变体版本 | 拒绝；不能伪造同意 | Auto |
| CART-LEGAL-04 | P1 | 正常 Checkout | 查订单记录 | 三个版本、时间、IP、UA 按最小必要记录 | Auto |
| CART-LEGAL-05 | P1 | 双击 Checkout | 查法律记录 | 只有一个订单和一组接受记录 | Auto |
| CART-LEGAL-06 | P1 | 用户拒绝继续 | 返回菜单 | 不创建订单、不写接受记录 | Auto |

## 11. 共享桌台、实时更新与并发（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-RT-01 | P1 | Guest A/B 扫同一有效桌码 | 比较 cartId/participantId | 同一 Active Cart、不同 participant/token | Auto |
| CART-RT-02 | P0 | Guest A/B | A 加商品，B 观察 | B 实时看到；数量/总额一致 | Assisted |
| CART-RT-03 | P1 | Guest A/B | A 加商品 | B 收到一次可读 activity banner；A 不收到重复他人提示 | Assisted |
| CART-RT-04 | P1 | SignalR 断开 | A 加商品，B 等 polling | B 在 fallback 周期恢复，不永久陈旧 | Assisted |
| CART-RT-05 | P1 | SignalR 重连 | 网络恢复 | 重新 JoinCart 并拉最新快照；不重复 banner | Assisted |
| CART-RT-06 | P0 | A/B 同时加同一组合 | 同秒提交 | 最终数量等于两次成功之和；不丢写 | Auto |
| CART-RT-07 | P0 | A/B 同时改同一行 | 不同目标数量 | 产生可识别冲突或确定规则；不得 UI 各自长期假成功 | Assisted |
| CART-RT-08 | P0 | A 删除、B 更新同一行 | 同时提交 | 一个成功，另一个明确 404/冲突并刷新 | Auto |
| CART-RT-09 | P0 | A Clear、B Add | 同时提交 | 最终状态符合事务顺序；所有客户端收敛 | Auto |
| CART-RT-10 | P0 | A/B 同时 Checkout | 同一 Cart 双提交 | 只生成一个 Order；两端得到同一 orderId | Auto |
| CART-RT-11 | P1 | A Checkout 成功 | B 仍在菜单 | B 收到 Submitted，Cart 只读并可进入同一 Checkout/订单状态 | Assisted |
| CART-RT-12 | P1 | 4+ participant | 连续快速加商品 | banner lanes 不覆盖关键操作，不出现无限积压 | Assisted |
| CART-RT-13 | P1 | participant 离开/关闭标签 | 其他人继续 | 不影响共享 Cart；离线者重开按规则恢复/重 Join | Assisted |
| CART-RT-14 | P0 | 错误 participant Token | 直接连接 Hub JoinCart | 被拒；不订阅 Cart 更新 | Auto |
| CART-RT-15 | P0 | Cart A Token | 尝试加入 Cart B Hub group | 被拒；无跨 Cart 事件 | Auto |
| CART-RT-16 | P1 | Cart 过期 | 多 participant 在线 | 所有人收到一次过期状态；无重复 Toast 风暴 | Assisted |
| CART-RT-17 | P1 | 服务端重启 | Active Cart 两客户端在线 | 自动重连/轮询恢复；数据仍在 DB | Assisted |
| CART-RT-18 | P1 | 浏览器睡眠 15 分钟 | 唤醒 | 拉最新快照；不会用休眠前旧状态覆盖服务端 | Assisted |
| CART-RT-19 | P1 | Customer A + Guest B 同桌 | 共同修改后 A Checkout | 订单所有者与规则明确；Guest B 不获得 A 的账号访问权 | Assisted |
| CART-RT-20 | P0 | Customer A/B 同桌 | B 在 A Checkout 前最后操作 | 订单归属不由“最后写入者”意外改变；策略可解释 | Assisted |

## 12. 营业状态、菜单变化、库存与服务端重校验（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-VAL-01 | P1 | Active Cart | 餐厅暂停后 Add/Update/Delete note | 写操作被拒并说明暂停 | Auto |
| CART-VAL-02 | P1 | Active Cart | 餐厅暂停后 GET | 仍可安全查看已有内容，不泄露其他数据 | Auto |
| CART-VAL-03 | P0 | 已有商品 | 暂停/打烊后 Checkout | 拒绝；无订单、无库存预留 | Auto |
| CART-VAL-04 | P1 | 恢复营业 | 刷新并继续 | Cart 未过期则可继续；金额重校验 | Assisted |
| CART-VAL-05 | P1 | 特殊营业日临界 | 在餐厅时区跨开门/关门点 | 以餐厅时区与服务端规则为准 | Assisted |
| CART-VAL-06 | P1 | 菜品变 Sold out | 已在 Cart 后 GET | 行明确 unavailable/sold out | Auto |
| CART-VAL-07 | P0 | 菜品变 Sold out | Checkout | 409 并指出受影响行；无订单 | Auto |
| CART-VAL-08 | P1 | 菜品恢复 | 刷新/修改 | 可继续，价格/声明按当前值 | Auto |
| CART-VAL-09 | P0 | 分类停用 | Checkout | 拒绝包含该分类菜品 | Auto |
| CART-VAL-10 | P0 | 菜品移到别店/数据异常 | Checkout | 拒绝 cross-restaurant；不创建订单 | Auto |
| CART-VAL-11 | P1 | tracked stock=2 | Cart 数量 3 Checkout | 拒绝并指出不足；库存不变 | Auto |
| CART-VAL-12 | P0 | 最后库存 1 | 两个 Cart 同时 Checkout | 仅一个成功；库存为 0 不为负 | Auto |
| CART-VAL-13 | P0 | 多行同 menuItem | Checkout | 按所有行总数量预留，不能逐行绕过库存 | Auto |
| CART-VAL-14 | P0 | Checkout 事务失败 | 在预留后、提交前注入失败 | 订单与库存一起回滚 | Auto |
| CART-VAL-15 | P1 | 无库存跟踪菜品 | 大合法数量 Checkout | 不被错误按 0 库存拒绝 | Auto |
| CART-VAL-16 | P1 | Table 停用 | 已有 Table Cart 修改/Checkout | 拒绝并说明桌台不可用 | Auto |
| CART-VAL-17 | P1 | Restaurant Stripe 未就绪 + PrepayRequired | Checkout | 在创建订单前明确拒绝 | Auto |
| CART-VAL-18 | P1 | PayAtCounterAllowed + Stripe 未就绪 | Checkout | 可创建订单并允许柜台付；线上入口不可用 | Auto |
| CART-VAL-19 | P1 | 菜单 API 与 Cart API 暂时版本不同 | 刷新 | 以服务端 Cart 重校验为准；不白屏 | Auto |
| CART-VAL-20 | P1 | Cart 35 行 | 一次 Checkout | 合理时间完成；失败明确指出具体行 | Auto |

## 13. Checkout、幂等、网络中断与 Guest Token（22）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-CHK-01 | P1 | Guest Takeaway | 正常 Checkout | 一个 Pending order；跳到 `/checkout`；取餐上下文正确 | Auto |
| CART-CHK-02 | P1 | Guest DineIn | 正常 Checkout | 桌号/Table Session/堂食上下文正确 | Auto |
| CART-CHK-03 | P1 | Customer | 正常 Checkout | order.customerId 正确；无 Guest token | Auto |
| CART-CHK-04 | P0 | 空 Cart | UI/API Checkout | UI disabled；API 400；无 Order | Auto |
| CART-CHK-05 | P0 | 快速双击 | 连点 Checkout | 按钮锁定；只创建一个 Order | Auto |
| CART-CHK-06 | P0 | API 重放 | 同 Cart 顺序 POST Checkout 两次 | 第二次返回同一 Order；不重复库存/通知/打印 | Auto |
| CART-CHK-07 | P0 | 两个并发请求 | 同时 POST Checkout | 同一 orderId；审计和 order.created 只一次 | Auto |
| CART-CHK-08 | P0 | 请求已到服务器 | 响应前断网，恢复后重试 | 恢复同一 Order；页面不要求重新下单 | Assisted |
| CART-CHK-09 | P0 | Guest + 响应丢失 | 服务端已创建但客户端未保存 one-time Guest token | 仍有安全的 participant-bound 恢复路径；不得产生无法访问的孤儿订单 | Assisted |
| CART-CHK-10 | P0 | Guest 正常响应 | 检查存储 | Guest token 只保存到最小范围；不进 URL/日志/截图 | Auto |
| CART-CHK-11 | P0 | 重试 Submitted Cart | 检查响应 | 不重新签发/泄露 Guest token；原客户端仍能访问订单 | Auto |
| CART-CHK-12 | P1 | Submitted Cart | 尝试 Add/Update/Delete/Clear/Note | 409 Cart no longer active | Auto |
| CART-CHK-13 | P1 | Submitted Cart | 刷新菜单入口 | 新建 Active Cart；旧订单保持可访问 | Auto |
| CART-CHK-14 | P0 | DB 异常：Submitted 但 Order 缺失 | 重试 Checkout | 明确 conflict 并告警；不得创建第二个无关联订单 | Auto |
| CART-CHK-15 | P1 | Pickup number | 并发创建多单 | 每单号码符合餐厅规则且不重复 | Auto |
| CART-CHK-16 | P1 | Table Session | 同桌连续两单 | 关联同一开放 Session；订单 ID 各自唯一 | Auto |
| CART-CHK-17 | P1 | Legal/price/allergen | 查 OrderItem 快照 | 名称、基础价、options、声明、note 与提交时一致 | Auto |
| CART-CHK-18 | P0 | Checkout 失败 | 查看 Staff/My Orders/Front/Admin | 不出现半成品订单；不触发打印 | Auto |
| CART-CHK-19 | P1 | Checkout 成功 | 查看副作用 | 实时/通知/打印任务各一次；按配置受众 | Assisted |
| CART-CHK-20 | P1 | 浏览器刷新 `/checkout` | 无 navigation state | 安全恢复或明确回菜单/订单；不白屏 | Auto |
| CART-CHK-21 | P1 | 直接打开 `/checkout` | 无 Cart | 明确缺少订单状态；不显示别人的订单 | Auto |
| CART-CHK-22 | P1 | 返回菜单 | Checkout 后返回 | 不把 Submitted Cart 当 Active；可安全开始下一单 | Auto |

## 14. 四个重点页面的交接与跨页订单（24）

本节是四个重点页面之间的契约测试。每个页面的更深层操作仍由自己的专项包负责，但任何一方修复后至少回归本节。

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-XPG-01 | P0 | Customer Checkout | 立即打开 `/my-orders` | 新订单只出现一次，orderId/number/总额一致 | Auto |
| CART-XPG-02 | P0 | Guest Checkout | 打开 `/my-orders`/Guest order 入口 | 只有正确 Guest token 能看；登录别的 Customer 看不到 | Auto |
| CART-XPG-03 | P0 | Customer A/B | A 下单，B 查看 My Orders | B 不出现 A 的订单；总数也不包含 | Auto |
| CART-XPG-04 | P1 | Customer Checkout | My Orders 已在另一标签 | 实时或刷新后出现，不需重新登录 | Assisted |
| CART-XPG-05 | P0 | 餐厅 A 订单 | Staff A `/staff/orders` | 新订单一次且字段完整 | Auto |
| CART-XPG-06 | P0 | 餐厅 A 订单 | Staff B tenant `/staff/orders` | 不出现；API 也不可访问 | Auto |
| CART-XPG-07 | P1 | DineIn | `/staff/orders` | 桌号、note、items、options、allergens、付款资格一致 | Auto |
| CART-XPG-08 | P1 | Takeaway | `/staff/orders` | 取餐号与类型正确，不显示虚构桌号 | Auto |
| CART-XPG-09 | P0 | 餐厅 A 订单 | `/staff/front-counter` | 正确桌台/队列出现一次 | Auto |
| CART-XPG-10 | P0 | 餐厅 A 订单 | Front Counter tenant B | 不出现；总数/桌台指标也不泄露 | Auto |
| CART-XPG-11 | P1 | PayAtCounter DineIn | Front Counter | 显示餐后付款；金额与 Cart 一致 | Auto |
| CART-XPG-12 | P1 | PayAtCounter Takeaway | Front Counter | 显示取餐付款；文案不说餐后 | Auto |
| CART-XPG-13 | P1 | Online Unpaid | Staff/Front | 不可误当 Paid 推进；付款资格一致 | Auto |
| CART-XPG-14 | P1 | Admin A | `/admin/orders` | 同一订单、同一金额/币种/状态 | Auto |
| CART-XPG-15 | P0 | Checkout 双击/重试 | 查四页面与 DB | 所有页面合计仍是一单，无重复通知/打印 | Auto |
| CART-XPG-16 | P1 | 订单状态变化 | Staff Accept，观察 My Orders/Front/Admin | 各页面最终收敛到相同状态与时间线 | Assisted |
| CART-XPG-17 | P1 | 支付状态变化 | 柜台收款/Stripe webhook | 四页面显示同一 payment status，不靠旧 Cart 状态 | Assisted |
| CART-XPG-18 | P1 | 订单取消/拒绝 | 跨页面观察 | 从活动队列移除但历史仍可查；不消失成未知 | Assisted |
| CART-XPG-19 | P0 | pageSize=10 已满 | 创建第 11 个更新订单并查看 page 1/2 | 跨页总数 11；订单不重复、不漏 | Auto |
| CART-XPG-20 | P0 | 按 createdAt desc 分页 | page1 打开后连续新建 3 单，再去 page2 | 使用刷新/稳定排序策略避免边界重复或明确提示数据已更新 | Assisted |
| CART-XPG-21 | P1 | 订单状态筛选已满一页 | 状态变化使订单离开筛选 | 页码钳制、总数更新；不显示 Page 0/空白假象 | Assisted |
| CART-XPG-22 | P1 | 同秒创建多单 | 跨页排序 | 使用稳定次级排序；刷新顺序可复现 | Auto |
| CART-XPG-23 | P1 | 从 My Orders Reorder | 旧单含下架/改价商品 | 可用行进入新 Cart；跳过行明确；新价格/选项重新校验 | Auto |
| CART-XPG-24 | P0 | Reorder + 旧 Cart 存在 | 执行 Reorder | 目标 Cart 规则明确，不覆盖另一餐厅/类型 Cart，不跨租户混单 | Auto |

## 15. 故障、恢复、缓存与服务重启（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-REC-01 | P1 | Menu API 失败、Cart API 正常 | 刷新 | 明确 Menu unavailable；不删除 stored Cart | Auto |
| CART-REC-02 | P1 | Cart GET 500 | 刷新 | 保留 storage，提供 Retry；不得立即新建并遗弃旧 Cart | Auto |
| CART-REC-03 | P1 | Cart GET 401 | 刷新 | 移除失效 storage 并安全新建；不泄露旧数据 | Auto |
| CART-REC-04 | P1 | Cart GET 410 | 刷新 | 显示过期后新建路径；旧行不复制 | Auto |
| CART-REC-05 | P1 | Add 请求超时，服务端未写 | 重试 | 最终只增加一次 | Auto |
| CART-REC-06 | P0 | Add 请求超时，服务端已写 | 重试 | 通过请求幂等或刷新确认避免重复增加 | Assisted |
| CART-REC-07 | P1 | Update/Delete 响应丢失 | 刷新 | 以服务端为准；UI 不保留假状态 | Assisted |
| CART-REC-08 | P1 | Backend 重启 | Active Cart 操作前后 | DB Cart 保留；重连后可继续 | Assisted |
| CART-REC-09 | P1 | Frontend HMR/重新部署 | Active Cart | storage 与服务端兼容；无法兼容时有迁移/重建提示 | Assisted |
| CART-REC-10 | P1 | DB 短暂不可用 | 修改 | 短错误且可重试；无长堆栈 Toast | Assisted |
| CART-REC-11 | P1 | SignalR 不可用 | 完整 Add→Checkout | 核心流程仍能靠 HTTP 完成 | Assisted |
| CART-REC-12 | P1 | 浏览器 offline | 尝试修改 | 不假成功；恢复后拉服务器状态 | Assisted |
| CART-REC-13 | P1 | Safari back-forward cache | Checkout 后后退 | Submitted Cart 不重新变可编辑 | Assisted |
| CART-REC-14 | P1 | Service Worker/HTTP cache | 两账号轮换 | Cart/订单响应 `no-store`；不显示前一人的内容 | Auto |
| CART-REC-15 | P1 | storage quota/security exception | Join/保存 Cart | 页面仍可用并明确非持久；不白屏 | Assisted |
| CART-REC-16 | P0 | Checkout 后 DB commit、通知失败 | 观察重试 | Order 只一个；通知可补偿，不重复订单 | Auto |
| CART-REC-17 | P0 | Checkout transaction deadlock/retry | 两并发 Cart 最后库存 | 正确重试/冲突；库存与订单一致 | Auto |
| CART-REC-18 | P1 | 长时间后台标签 | 回到前台 | 先刷新快照再允许写；不提交陈旧价格/库存 | Assisted |

## 16. 权限、隐私、安全、无障碍与响应式（20）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-SEC-01 | P0 | 枚举 cartId | 无/错 Token 批量 GET | 通用拒绝、有限流；不可读取存在性和内容 | Auto |
| CART-SEC-02 | P0 | Token | 检查 URL、DOM、console、analytics、server log | 完整 Token 不出现 | Auto |
| CART-SEC-03 | P0 | XSS 输入 | 商品/Cart note 与菜单名含危险字符 | React/打印/日志全链路转义 | Auto/Assisted |
| CART-SEC-04 | P1 | CSRF/CORS | 跨站发修改请求 | 自定义 Token header/CORS 策略阻止未授权调用 | Auto |
| CART-SEC-05 | P1 | Burst | 快速 Join/Add/Checkout | 合理限流；正常共享桌台不被永久封锁 | Auto |
| CART-SEC-06 | P0 | 账号切换 | A 登出、B 登录、浏览器后退 | 不显示 A 的 My Orders/PII；Cart 所有权策略明确 | Assisted |
| CART-SEC-07 | P1 | 截图/错误 | 触发所有常见失败 | 无 Token、JWT、堆栈、SQL、内部 ID 大段泄露 | Auto |
| CART-PRIV-01 | P1 | Guest Cart | 查 DB participant/order | 仅存 Token hash；Guest 明文 Token 不落库 | Auto |
| CART-PRIV-02 | P1 | 未提交过期 Cart | 触发保留任务 | 按政策删除/去标识；Legal Hold 例外可审计 | Auto |
| CART-PRIV-03 | P1 | 健康备注 | Staff/Front/Admin 查看 | 仅履约角色可见；导出/日志不无关扩散 | Auto |
| CART-A11Y-01 | P1 | Keyboard | 从菜单加商品、开 Cart、改数量、保存 note、Checkout | 全程可键盘完成，焦点可见 | Assisted |
| CART-A11Y-02 | P1 | Dialog | Clear、切类型、未保存 note | 焦点锁定、Esc/Cancel、安全返回触发器 | Assisted |
| CART-A11Y-03 | P1 | Screen reader | 读 Cart 底栏、数量、总价、loading/error | 控件有名称；更新使用适度 live region | Assisted |
| CART-A11Y-04 | P1 | 200% zoom | 大 Cart | 无横向截断；Checkout/关闭可达 | Assisted |
| CART-A11Y-05 | P2 | Reduced motion | 实时 banner/抽屉 | 尊重减少动画；信息仍可见 | Assisted |
| CART-RSP-01 | P1 | iPhone Safari | 完成 Add→Cart→Checkout | 底栏不被浏览器工具栏/安全区遮挡 | Assisted |
| CART-RSP-02 | P1 | Android Chrome | 同上 | 无横向溢出；键盘不遮 note/Save | Assisted |
| CART-RSP-03 | P1 | Tablet | 横竖屏切换且 Cart 展开 | 状态和滚动位置合理，控件不重叠 | Assisted |
| CART-RSP-04 | P1 | 320px 宽 | 长名称/币种/大金额 | 行可读，数量和删除可点击 | Assisted |
| CART-RSP-05 | P1 | Touch | 快速点 +/-/Checkout | 触控目标足够；无误触双提交 | Assisted |

## 17. 清理与通过门槛（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| CART-CLEAN-01 | P1 | 本轮 Cart | 导出 cartId/orderId 后删除一次性记录 | 只删除登记的测试数据 | Auto |
| CART-CLEAN-02 | P1 | 改动菜单/库存 | 恢复价格、库存、状态、选项、过敏原 | 与 PRE 基线一致 | Auto |
| CART-CLEAN-03 | P1 | 改动 expiresAt | 恢复/删除夹具 | 无临界时间记录遗留 | Auto |
| CART-CLEAN-04 | P1 | 桌台 Session | 关闭本轮测试 Session | 不影响真实桌台 | Auto |
| CART-CLEAN-05 | P1 | 浏览器 | 清除本轮 Cart/Guest order storage 和测试身份 | 不清其他用户数据 | Auto |
| CART-CLEAN-06 | P1 | 打印/通知 | 恢复原配置并清理测试任务 | 不遗留待打印任务 | Assisted |
| CART-CLEAN-07 | P1 | 订单核对 | 对比 Cart、Order、Items、库存、审计、通知数量 | 无孤儿、重复或负库存 | Auto |
| CART-CLEAN-08 | P1 | Git | 检查测试产生的未跟踪文件 | 只保留报告/evidence/log；不改业务文件 | Auto |

发布/试运营门槛：所有 `CART-*` P0 必须为 0；`CART-CHK-09`（Guest 响应丢失恢复）、`CART-SES-18`（登录 Session 完全过期）、`CART-VAL-12`（最后库存并发）、`CART-RT-10`（共享 Cart 双 Checkout）和 `CART-XPG-15`（四页面无重复）必须有真实 PostgreSQL 环境证据，不能只凭 UI 截图判定通过。

## 18. 后续三个重点页面的最小衔接清单

编写剩余专项包时，必须至少引用以下桥接用例，不能各测各的：

| 后续包 | 必须复用 | 还需新增的核心维度 |
|---|---|---|
| `my-orders` | `CART-XPG-01..04,16..24` | 登录/Guest 可见性、跨餐厅历史、筛选/分页、取消、退款、Receipt、Reorder、会话过期 |
| `staff-orders` | `CART-XPG-05..08,13,15..22` | 厨房状态机、临近/超时订单、声音、排序、分页、两员工冲突、打印、Session 过期 |
| `front-counter` | `CART-XPG-09..13,15..22` | 桌台 Session、柜台收款、餐前/餐后、合并/拆分、交班、断网、Session 过期 |
