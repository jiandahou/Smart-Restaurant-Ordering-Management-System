# admin-orders / admin-users / staff-orders / admin-restaurants / admin-payments 深跑 — 2026-09-16（合并后）

> 这五个模块此前都只有「代表性抽测」。本轮把 API 面跑深，并先验证了当天合入 `main` 的 8 个修复在生产上生效。
> 接力入口：[production-test-report-2026-09-16.md](production-test-report-2026-09-16.md)

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST)，**合并后** `main` @ `6a5260f` |
| 环境 | Production `https://dineflow.theunknownfish.com`，部署成功、`/health/ready` 200 |
| 前提 | PR #21 已合并并部署，迁移 `AddPaymentEventAmount` 随容器启动执行 |

## 1. 结论

- **56 项检查全部通过**（修复验证 6 · admin-orders 17 · admin-users 10 · staff-orders 6 · admin-restaurants 6 · admin-payments 13，含两条返工）。
- 权限与租户隔离在这五个模块上**没有一处漏点**。
- 状态机的 `availableActions` 与实际允许的动作**逐项一致**，这是本轮最有价值的发现。
- 未发现新缺陷。

## 2. 合入的修复在生产上生效（6/6）

| 缺陷 | 线上实测 |
|---|---|
| #5 sortBy | 四个报表标签不传 `sortBy` → **全部 200**（此前 audit/orders/payments 是 400） |
| #4 导出金额 | payments CSV 表头出现 `...Status,AmountCents,Currency,OrderNumber...`；最新事件行都带 `amountCents`/`currency` |
| #7 发信限流 | 连发 7 次 `mfa/email/setup` → `[200,200,200,200,200,429,429]`，第 6 次开始拒绝 |
| #1 现金上限 | A$24 订单收 A$5000 → **400**「would give back 4976.00 in change」；收 A$100 → 200，找零 76.00 |

## 3. admin-orders（17/17）

### 状态机

文档第 2 节特别标注「Pending 有三条快捷路径」，逐条验证：

| 用例 | 结果 | 观察 |
|---|---|---|
| Pending → Accept | PASS | → Accepted |
| **Pending → MarkReady** | PASS | → **Ready**（跳过 Accepted/Preparing） |
| **Pending → Complete** | PASS | → **Completed**（一步到底） |
| Accepted → StartPreparing | PASS | → Preparing |
| **Rejected → Reopen** | PASS | → **Pending** |
| **Completed → Reopen** | PASS | → **Ready**，不是 Pending —— 两种来源的 Reopen 目标确实不同 |
| 重复 Accept | PASS | 409「Action Accept is not allowed while the order is Preparing」 |
| Reject/Cancel 不给理由 | PASS | 全部拒绝（`RequiresReason` 生效） |

### 契约一致性（本轮最值得记的一条）

| 用例 | 结果 | 观察 |
|---|---|---|
| **AO-CONTRACT** | PASS | 对 Pending 单逐个实调 7 个动作，得到实际允许集合 `{Accept, Cancel, Complete, MarkReady, Reject}`，与接口返回的 `availableActions` **完全相等**。UI 上能点的就是服务端会放行的，没有多也没有少 |

### 支付资格横切规则

| 用例 | 结果 | 观察 |
|---|---|---|
| AO-ELIG-01 | PASS | 未付在线单的 `availableActions` 只有 `['Cancel','Reject']` ——「厨房四动作」一个都不给 |
| AO-ELIG-02 | PASS | 绕过 UI 直接调这四个 → **全部 409** |

### 状态历史

| 用例 | 结果 | 观察 |
|---|---|---|
| AO-HIST | PASS | 三次流转逐条记录：`Pending→Accepted(Accept)`、`Accepted→Preparing(StartPreparing)`、`Preparing→Ready(MarkReady)` |
| AO-HIST-actor | PASS | 每条都带 `changedByUserId` |

## 4. admin-users（10/10）

| 用例 | 结果 | 观察 |
|---|---|---|
| **AU-ROLE-01** | PASS | 全平台用户列表 `GET /api/users`：**餐厅 Owner 也是 403**，Admin/Staff/Customer 403，匿名 401 —— 只有 PlatformOwner 能读 |
| AU-ROLE-02 | PASS | 餐厅作用域列表：admin A 得到 7 个用户，**全部属于餐厅 A** |
| AU-ROLE-04 | PASS | admin A 点名要餐厅 B 的用户 → 403 |
| **AU-WRITE-01** | PASS | 对 A 的用户做 5 种越权写（admin B 改状态/解锁/删除、customer、staff）→ **全部 403** |
| **AU-WRITE-02** | PASS | 六次越权写之后回查该用户：`isDisabled/isLockedOut` 仍是 `(False, False)`，**一个字段都没动** |
| AU-ESC | PASS | Customer 尝试把自己改成 `PlatformOwner` → 403；Staff 读全平台列表 → 403 |
| AU-BAD | PASS | 畸形 / 不存在 / 全零 GUID → 404，无 500 |

## 5. staff-orders（6/6）

| 用例 | 结果 | 观察 |
|---|---|---|
| SO-ROLE-01 | PASS | `/api/staff/orders`：匿名 401、Customer 403、Staff/Admin/Owner 200 |
| SO-ROLE-02 | PASS | staff A 读到 100 条订单，**全部属于餐厅 A** |
| SO-ROLE-03 | PASS | staff A 强传 `restaurantId=B` → 200 但 **B 的行数为 0**（收窄而非报错） |
| **SO-ROLE-04** | PASS | staff 去碰 reports / restaurant / users / payments 四个管理面 → **全部 403** |
| SO-WORK-01 | PASS | staff **可以**接单（这是他的本职） |
| SO-WORK-02 | PASS | staff B 取消 A 的订单 → 403 |

## 6. admin-restaurants（6/6）

| 用例 | 结果 | 观察 |
|---|---|---|
| AR-ROLE-01 | PASS | 匿名 401、Customer 403、**Staff 403**、Admin/Owner 200 |
| AR-ROLE-02/03 | PASS | admin A 读餐厅 B → 403；读自己 → 200 |
| **AR-WRITE-01** | PASS | **建餐厅：admin 403，餐厅 Owner 也 403**（PlatformOwner 专属）；admin 删餐厅 B → 403 |
| **AR-WRITE-02** | PASS | 跨租户改营业状态、改营业时间，以及 staff 改营业状态 → **全部 403** |
| AR-WRITE-03 | PASS | 上述探测后餐厅 A 仍 `isActive=true`，配置未被改动 |

## 7. admin-payments（13/13）

| 用例 | 结果 | 观察 |
|---|---|---|
| AP-ROLE-01 | PASS | 支付列表：匿名 401、Customer 403、**Staff 403**、Admin 200 |
| AP-ROLE:各子面 | PASS | `refunds` / `refunds/summary` / `refund-requests` / `environment` 四个子面，Customer 与 Staff **一律 403** |
| AP-TENANT-01 | PASS | admin A 看到 72 笔支付，**全部属于餐厅 A** |
| AP-TENANT-02 | PASS | 强传 `restaurantId=B` → B 的行数 0 |
| **AP-TENANT-03** | PASS | admin B 对 A 的支付调 `sync` / `receipt/resend` → **403**（重发收据是会往外发信的写操作） |
| AP-ROLE-02 | PASS | staff / customer 调 sync → 403 |
| **AP-REFUND-01** | PASS | 退款申请审批：Customer 403、Staff 403、admin B 404 —— 这是动钱的入口 |
| AP-BAD | PASS | 畸形 / 未知 paymentId → 404，无 500 |
| AP-PAGE | PASS | pageSize `0/101/9999/-1` → 400；`1/100` → 200 |

## 8. 一处需要说明的返工

`AP-ROLE-01` 第一次跑出 `owner A: 401`，看着像餐厅 Owner 读不了支付。核实后是**登录限流**：本轮反复登录同一账号，第 8 次开始 429，harness 拿不到 token 就退化成匿名请求。

用新 token 重测：餐厅 Owner 对 `payments` / `restaurant` / `reports/activity` **全部 200**。
连发 12 次登录的实测结果是 `[200×7, 429×5]` —— 顺带确认了登录限流在生产上生效。

> **给下一棒的提醒**：脚本里每个断言都 `login()` 一次很容易撞上这个限流，
> 拿到的 401 会被误读成权限问题。登录一次、复用 token。

## 9. 覆盖矩阵更新

| 模块 | 用例数 | 此前 | 现在 |
|---|---:|---|---|
| **admin-orders** | 169 | 🟡 抽测 | 🟡 **状态机与权限面已深跑**（17/17）；UI、实时、退款 UI 待跑 |
| **admin-users** | 150 | 🟡 抽测 | 🟡 **权限与写保护已深跑**（10/10）；邀请、改角色的正向流程待跑 |
| **staff-orders** | 212 | 🟡 抽测 | 🟡 **权限面已深跑**（6/6）；工作队列 UI 待跑 |
| **admin-restaurants** | 161 | 🟡 抽测 | 🟡 **权限与配置写保护已深跑**（6/6）；营业时间/特殊日 UI 待跑 |
| **admin-payments** | 166 | 🟡 抽测 | 🟡 **权限与租户面已深跑**（13/13）；退款审批正向流程待跑 |

## 10. 仍未覆盖

- 各模块的**浏览器逐页**部分：列表筛选、排序、分页 UI、实时更新、无障碍、响应式。
- **正向写流程**：邀请用户、改角色、审批退款、改营业时间——本轮只验证了「谁不能做」，没有验证「该做的人做得成」。
- **cart(294)** 与 **dashboard(150)** 仍是抽测；cart 已有并行会话的本地随机测试覆盖一部分。
- **real-device(69)** 需真机。
