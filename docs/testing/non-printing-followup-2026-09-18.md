# 非打印点餐与退款补测 — 2026-09-18

## 环境与边界

- 分支 `jianda-payment-test-2026-09-16`，基准 `34362f9`；初始 3 个脏路径保留。新增测试文件，无业务代码修改。
- API 使用 DineFlowApiFactory、真实 HTTP 管道、独立 PostgreSQL 16 临时数据库、.NET SDK 8.0.423。模拟 Customer/Guest/Admin/Staff，不使用生产账号或生产数据库。
- 浏览器 Chrome：本机 LAN `10.118.160.10:5173` Customer 菜单、`localhost:5173/staff/orders` Owner。运行中 Docker 应用版本未重新对齐基准 commit，因此 UI 证据与源码集成测试分开。
- 打印机暂停，现有员工页自动接单开启：没有在运行中应用创建订单、触发出票或更改打印设置。菜单重试产生空购物车，不含订单。
- Stripe 是测试替身，不连接 Stripe Sandbox/live。付款成功状态是隔离数据夹具；退款申请、审核、库存、数据库与顾客查询经过真实 API。
- 证据目录：`test-results/20260918-003537`（忽略的本地生成产物）。

## 结果口径

最终自动化：**34 PASS / 0 FAIL / 0 SKIP**，其中新增 8 个测试、已有 26 个回归。第一次新增文件编译缺引用及一次临时 SDK 缺依赖缓存已修正；属于测试准备问题，不算产品失败。仍有旧 PrivacyRequestApiTests.cs:133 CS8604 警告。

**注意：8 个新增测试中有 1 个是行为记录测试，不是产品验收通过。** 它确认 Guest 抢先提交时订单不归 Customer，与之前“Customer + Guest 同桌订单归 Customer”的验收要求不一致，见 GAP-0918-01。自动化绿色不能关闭该需求差异。

### 新补 API 场景

| 场景 | 验收结果 | 实际观察 |
|---|---|---|
| Customer 先提交，Guest 重试 | PASS | 同一 orderId；Guest 无顾客订单凭证；My Orders 401，guest lookup 空列表 |
| 两 Customer，第二位重试 | PASS | 同一 orderId，数据库所有者不变；第二位 My Orders 为空 |
| 退出登录复用账号绑定的 participant token | PASS | identity_changed 拒绝，未新增菜品 |
| 四个独立参与者共 40 次并发加菜 | PASS | 四份 API 快照均为 40 份、400 AUD；这是 API 并发，不是四台真实设备 |
| 两个独立购物车竞争最后一个 addon | PASS | 一次成功、一次 409；一个订单；item 100→99，addon 1→0 |
| 退款申请→Admin 批准→重复批准→My Orders | PASS（模拟 Stripe） | Approved 可见；第二次 409；退款记录 1 条、1000 分；订单 Cancelled；item 99→100、addon 0→1；Stripe 替身退款调用一次 |
| 退款申请→Admin 拒绝→My Orders | PASS | 空拒绝原因 400；有效原因回传顾客；无退款，仍 Paid，库存仍保留 |
| Customer 先加入加菜，Guest 抢先提交 | FAIL（按先前验收要求） | CustomerId=null；Customer 重试返回同一 Guest 订单，My Orders 仍为空 |

既有回归 26 项：柜台收款/权限/重复及双柜台竞争、整桌结算原子性与双 Staff 竞争、全额/部分退款库存策略、退款超时幂等恢复、Checkout 会话恢复。最终证据 `logs/followup-complete.trx`；中间两轮 13/33 项不与最终结果累加。

### 浏览器 6 项

| 场景 | 结果 | 观察 |
|---|---|---|
| 过期 Cart 重试 | PASS | 初始 Cart expired，Try again 后菜单正常，空购物车 |
| Takeaway 深链刷新 | PASS | 刷新完成后仍 Takeaway，没有再次要求选类型 |
| 菜单无结果搜索及清空 | PASS | 0/18、No items found；清空后 18/18 |
| 售罄禁用与 Available now 筛选 | PASS | 4 个售罄 Add 禁用；筛选 14/18，取消恢复 18/18 |
| Customer 直接访问 Staff Orders | PASS | 页面 Access denied / Customer / 403，无队列内容 |
| Staff 搜索和清空 | PASS | 无匹配提示；清空后计数恢复 Payment holds 36、Carried over 134、Closed 753 |

截图 `evidence/001-menu-available-filter.png`。未更改员工状态、收款、历史订单；浏览器搜索/筛选均已恢复。权限检查不证明全部 UI 加载过程绝无瞬时信息闪现。

## GAP-0918-01：同桌混合身份订单归属受首次提交者影响

- 优先级：**P1，需求差异待决策**；不是已确认的资金损失或跨账号窃取。
- 复现：Customer A 加入桌码→Guest B 加入同一 cart→A 加一份→B checkout→A checkout 重试→A 查询 My Orders。
- 先前验收要求：Customer + Guest 同桌订单归 Customer。
- 实际：数据库 CustomerId 为 null；两次相同 orderId；A 的 My Orders 无订单。当前实现明确以 checkout 调用者决定归属，而不是以加入者/加菜者决定。
- 证据：`SharedCartReleaseGapTests.GuestSubmitsBeforeCustomer_OrderRemainsGuest`；`PublicCartsController.cs` checkout 的 orderCustomerId 从当前用户身份取得。
- 建议：先明确共享订单“付款人/所有者”如何选择；若要求自动归 Customer，需要确定多个 Customer 时规则，不能简单选最后操作人。当前测试只是记录行为，不应作为批准此规则的依据。
- 未实施修复，本轮是测试请求。

## 尚未执行

- NOT RUN：浏览器独立身份同桌、真实断网/恢复、SignalR 乱序/漏事件、手机后台恢复；API 独立 client 不能替代这些。
- NOT RUN：真实 Stripe Sandbox 的审核退款与回调对账、3DS、拒单同时付款；本轮没有设置专用 Sandbox 付款。
- NOT RUN：并发 Guest/Customer 抢先提交的所有交错、同桌非所有者的完整 UI 恢复；本轮只覆盖明确顺序及 API 加菜并发。
- NOT RUN：物理打印、手机和平板、live 支付、备份清库/部署演练。打印按用户要求排除。

无需现在连接打印机。下一步先决定 GAP-0918-01 的归属规则，再补双浏览器实时恢复及专用 Sandbox 订单四端对账。
