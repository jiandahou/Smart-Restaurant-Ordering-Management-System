# DineFlow 生产测试总报告 — 2026-09-15

> **一份自包含报告，供跨 session 接力。** 汇总本轮对**生产环境**的全部黑盒/E2E 测试结果。单元/集成测试(后端 730 + 前端 vitest)在 CI 上随每次 push 运行且全绿，不在此重复；本报告只覆盖**对活体系统的校验**。

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-15 (ACST) |
| 环境 | **Production** `https://dineflow.theunknownfish.com`（EC2 t4g.medium + AWS S3 + Cloudflare Tunnel） |
| 分支/提交 | `main` @ `d1e22f0`（jianda 应用合并 + 部署配置 + 登录改动） |
| 后端环境变量 | `ASPNETCORE_ENVIRONMENT=Staging`（保留 seed+自动迁移，跳过合规硬门槛；真上线切 Production） |
| Stripe | **Sandbox（测试模式）**，无真实扣款 |
| 数据 | 当前为 seed/演示数据（非真实业务数据），测试建的临时数据已清理 |

## 1. 结论（TL;DR）

- **2026-08-09 发布报告的 4 个 P0 阻塞项已基本关闭**：登录锁定/限流/密码长度/生产不预填、部署闭环+CI 跑测试。
- **权限与跨租户隔离扎实**；核心下单→接单链路正常；实时(SignalR)、S3 图片、webhook(sandbox) 正常。
- **admin-menu 深跑 24 PASS / 1 FAIL**（选项组空名校验缺失）/ 1 未确认。
- **唯一功能性阻塞：在线支付**——无餐厅完成 Stripe Connect 入驻，`payment-system`(223) 与在线付款/退款(G) 无法验证（配置缺口，非缺陷）。

## 2. 全系统跨模块结果（代表性抽测）

### 2.1 登录硬门槛（对照 08-09 的 FAIL）
| 用例 | 08-09 | 现在(生产) |
|---|---|---|
| B03 连错密码锁定 | FAIL | ✅ 连错 4 次 → 423 锁定 15 分钟 |
| B04 登录限流 | FAIL | ✅ 第 10 次 → 429 |
| B05 密码最短长度 | FAIL(6 位) | ✅ 6 位被拒「至少 8 位」，9 位通过 |
| B14 生产预填演示账号 | FAIL | ✅ 生产登录页为空、包内无密码 |
| B01/B02/B06 | — | ✅ 正常登录 / 通用错误提示 / 未接受条款拒绝 |

### 2.2 权限与租户隔离（C）
| 端点 | 餐厅OwnerA | AdminA | StaffA | Customer | Guest |
|---|:-:|:-:|:-:|:-:|:-:|
| admin/orders | 200 | 200 | 200 | 403 | 401 |
| admin/menu/categories | 200 | 200 | 403 | 403 | 401 |
| admin/reports/activity | 200 | 200 | 403 | 403 | 401 |
| restaurant | 200 | 200 | 403 | 403 | 401 |
| **跨餐厅读 B 的菜单(C07)** | **403** | **403** | — | — | — |

### 2.3 订单 / 通知 / 集成
- 顾客下单 → 管理端**实时出现**(订单数+1)→ 接单 Pending→Accepted ✅（浏览器实测）
- **业务门槛**：未付的在线单不能进厨房流程 → 409（正确）
- 订单列表状态筛选正常；SignalR **Live** 徽章、共享购物车实时同步 ✅
- 后端 `/health/ready` = database ok；S3 菜单图 200；seed 头像 200；Stripe webhook 400=验签生效（sandbox trigger 投递+处理正常）
- 并发/负载：30 并行 /health、15 并行带鉴权 API 全 200

## 3. 各模块覆盖进度矩阵（docs/testing 专项用例，共 ~2,449 条）

| 模块 | 用例数 | 状态 | 说明 |
|---|---:|---|---|
| login-registration | 89 | 🟢 较全 | 锁定/限流/密码/条款/生产不预填 |
| 权限与租户隔离(C) | — | 🟢 完成 | 多角色 RBAC + 跨租户 403 |
| **admin-menu** | 182 | 🟢 **Auto 已深跑** | 见第 4 节;24 PASS / 1 FAIL / 1 未确认 |
| admin-orders | 169 | 🟡 抽测 | 筛选/流转校验/支付门槛/status-history |
| admin-reports | 176 | 🟡 抽测 | activity 读取+导出、权限 |
| admin-restaurants | 161 | 🟡 抽测 | 列表/详情/跨租户隔离 |
| admin-users | 150 | 🟡 抽测 | 全域仅 Platform Owner 可读 |
| dashboard | 150 | 🟡 抽测 | 页面读取(前端聚合，无单一 API) |
| staff-orders | 212 | 🟡 抽测 | staff 可读订单、越权→403 |
| cart | 294 | 🟡 抽测 | 下单→购物车→结账→下单、共享同步 |
| notifications(SignalR) | — | 🟢 抽测 | Live 徽章、实时同步 |
| front-counter | 182 | 🔴 未跑 | 需浏览器逐页 |
| profile-security | 157 | 🔴 未跑 | 需邮箱/TOTP/Passkey |
| payment-system | 223 | 🟡 主链路已跑 | 2026-09-16 入驻完成后解锁，见 [payment-system-test-run-2026-09-16.md](payment-system-test-run-2026-09-16.md) |
| real-device | 69 | 🔴 未跑 | 需真机/读屏 |

图例:🟢 完成/较全 · 🟡 代表性抽测 · 🔴 未跑 · ⛔ BLOCKED

## 4. admin-menu 深跑详情（24 PASS / 1 FAIL / 1 未确认）

| Case ID | 结果 | 观察 |
|---|---|---|
| MENU-ROLE-03/04 | PASS | Staff 调菜品 CRUD/库存/选项组 → 403 |
| MENU-ROLE-06 | PASS | Admin A 调餐厅 B 菜品 GET/sold-out/stock/DELETE → 全 403 |
| MENU-ROLE-12 | PASS | 随机/畸形 id → 404，无堆栈/SQL |
| MENU-CAT-02/03/07 | PASS | 建分类 201;空名 400;**删含菜品分类 409** |
| MENU-ITEM-03/05/06/09/21 | PASS | 空名 400;价 0 拒绝;负价 400;建菜品 201;重名 409 |
| **MENU-ALG-08** | PASS | 无麸质+过敏原「小麦」矛盾 → **409 阻止**;带确认标记 → 201 |
| MENU-STOCK-01/06/07/08/10/11/12/13 | PASS | 库存 0→自动售罄;负库存拒绝;adjustBy **原子加减**;超减夹 0+售罄;双参数/未跟踪拒绝;上/下架 |
| MENU-OPT-01/04/05 | PASS | 建组 201;min>max 400;必选组 min=0 400 |
| **MENU-OPT-02/21** | **FAIL** | **选项组名 `""`/`"   "` 被接受(201)且未 trim——空白名校验缺失** |
| MENU-ALG-04 | 未确认 | 空过敏原建菜品 201;`allergenInfoLastVerifiedAt` 是否 null 未经 API 确认，建议浏览器复核 |

**admin-menu 未覆盖**（需浏览器逐页，后续接力）：MENU-PAGE(18 搜索/筛选)、MENU-IMG(10 图片上传)、MENU-REC/PUB(28 排序+顾客端一致性)、各 Assisted(顾客端/小票对比、并发)。

## 5. 发现的问题 / 待办

| # | 严重度 | 问题 | 位置/修法 |
|---|---|---|---|
| 1 | ~~低（校验缺失）~~ 已修 | ~~**选项组名接受空白/纯空格且不 trim**(MENU-OPT-02/21)~~ | 已在 `3f66128` 修复并合入 `main` |
| 2 | ~~配置缺口~~ 已解除 | ~~**在线支付不可用**~~ | 餐厅 A 已于 2026-09-16 完成 test 模式入驻；主链路已验证。**新问题**：该账户业务名填成了「Central Market Table」，见 09-16 报告问题 #1 |
| 3 | 说明 | owner@dineflow.com 密码已被改动（`SEED_OWNER_PASSWORD`） | Platform Owner 专属项需新密码后补测 |
| 4 | 待确认 | MENU-ALG-04 核验时间戳 | 浏览器复核 |

## 6. 接力指引（其他 session 接着跑）

**环境/入口**
- 生产 URL：`https://dineflow.theunknownfish.com`（也是所有 `/api/*` 的同源前缀）
- EC2 SSH：`ssh -i ~/Downloads/dineflow.pem ubuntu@13.211.142.174`（安全组 SSH 仅放行执行者 IP）
- 代码在 EC2：`~/Smart Restaurant Ordering System`；部署：push `main` 自动经 self-hosted runner 部署

**seed 账号（密码统一 `DineFlow123!`）**
- Platform Owner：`owner@dineflow.com`（密码已改，非 DineFlow123!）
- 餐厅 Owner：`owner.one@dineflow.test`(餐厅A) / `owner.two@dineflow.test`(餐厅B)
- Admin：`admin.one.a@dineflow.test`(A) / `admin.two.a@dineflow.test`(B)
- Staff：`staff.one.a@dineflow.test` … / Customer：`customer.one@dineflow.test` …
- 餐厅 ID：A=`11111111-1111-1111-1111-111111111111`(The DineFlow Kitchen)，B=`22222222-2222-2222-2222-222222222222`(Spice Garden)，另有 Central Market Table=`aaaaaaaa-…`

**跑法**
- API：`POST /api/auth/login {email,password}` → `token`；带 `Authorization: Bearer <token>`。菜单/订单/库存等 CRUD 用 `/api/admin/...` 端点（见各 Controller）。
- 改数据类用例允许跑（当前为演示数据）；跑完请**清理临时数据**（本轮已清）。
- 单元测试**不要**对生产库跑（会建/删测试库）。

**优先接力项**（2026-09-16 更新）
1. ~~修 #1 选项组空名校验~~ 已修 (`3f66128`)
2. ~~Stripe Connect 入驻后跑 payment-system~~ 主链路已跑；**剩 3DS/Radar/争议、Klarna 异步、其余成功卡矩阵**
3. admin-menu 浏览器组(PAGE/IMG/REC/PUB) 与其余模块的浏览器逐页
4. front-counter(182) / profile-security(157) / real-device(69) 仍未跑
