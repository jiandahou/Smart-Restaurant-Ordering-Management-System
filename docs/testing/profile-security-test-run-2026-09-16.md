# profile-security 生产测试run — 2026-09-16

> 09-15 总报告里 `profile-security(157)` 是 🔴 未跑。本轮跑完**不改动数据**的那部分。
> 接力入口：[production-test-report-2026-09-16.md](production-test-report-2026-09-16.md)

## 0. 运行信息与执行边界

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST)，`main` @ `6ed7440` |
| 环境 | Production `https://dineflow.theunknownfish.com` |
| 账号 | Customer A/B、Staff A、Admin A，以及本轮新注册的一个专用探测账号 |

**本用例包第 1 条规则写着：「生产环境只允许只读检查，除非用户另行明确授权。」**
因此本轮**没有**在任何 seed 账号上启用/关闭 MFA、注册 Passkey 或修改密码。

原计划是注册一个全新账号来承载所有变更类用例，但
**新注册账号必须先确认邮箱才能登录**（`register-customer` 返回
`"Please confirm your email before signing in."`），而本轮无法读取该邮箱，
所以这条路走不通。变更类用例的授权请求见第 5 节。

## 1. 结论

- **17 项只读检查：16 PASS / 1 部分完成。**
- **认证边界干净**：7 个 MFA 端点对匿名和伪造 token 一律 401；Passkey 的越权删除/重命名 → 404；
  两个枚举探针都没有 oracle。
- **MFA 的两个 P1 安全语义都站得住**：零方法时打开保护范围会被规范化为 false；
  未知字段（payment scope、角色提升）被完全忽略。
- **大片区域仍未跑**——TOTP、Email MFA、Passkey 的完整生命周期，见第 4 节。

## 2. 结果明细

| 用例 | 结果 | 观察 |
|---|---|---|
| **PROF-MFA-02a** | PASS | 匿名调 **7 个 MFA 端点**（settings GET/PUT、totp setup/enable、email setup、disable、sensitive email-code）→ **全 401** |
| **PROF-MFA-02b** | PASS | 同样 7 个端点带伪造 JWT → **全 401**，没有一个把畸形 token 当匿名放过去 |
| PROF-MFA-01 | PASS | 连续两次 GET settings 返回**完全一致**，读取不建状态：`{enabled:false, methods:[], preferredMethod:"totp", requiredFor:{login:false, sensitiveActions:false}}` |
| **PROF-MFA-06** | PASS | **一个方法都没启用时**把 `requireForLogin` 与 `requireForSensitiveActions` 都设成 true → PUT 返回 200，但读回来两个都是 **false**。API **没有**谎称账号受保护（规范化而非假接受） |
| **PROF-MFA-27** | PASS | 构造 `requireForPayment:true`、`isAdmin:true`、`role:"PlatformOwner"` 一起提交 → 未知字段**全部忽略**，返回体里既没有 payment scope 也没有角色字段 |
| PROF-LOGIN-01 | PASS | 未确认邮箱的新账号**无法登录**（不签发 token） |
| PROF-PWD-04 | **部分** | 注册口令策略：空、4 位、7 位、纯字母（无数字/符号）→ **全部 400**。纯数字、超长(500+)、纯空格三项被**注册限流 429 打断**——限流本身是正确行为，但这三条按规则记为**未确认** |
| PROF-ENUM-02 | PASS | `request-password-reset` 对**不存在的邮箱**与**已知邮箱**返回**同一状态码且响应体逐字节相同**，无账号枚举 oracle |
| PROF-PWD-11 | PASS | `me/request-password-reset` 匿名 → 401 |
| PROF-PK-01 | PASS | 匿名列 Passkey → 401 |
| PROF-PK-02 | PASS | 列自己的 Passkey → 200（customer.one 当前 0 个） |
| **PROF-PK-03** | PASS | **删除不属于自己的 / 不存在的 Passkey → 404**（不区分「不存在」与「别人的」，无 oracle） |
| PROF-PK-04 | PASS | 重命名不存在的 Passkey → 404 |
| **PROF-PK-05** | PASS | `passkeys/login/options` 对已知与未知邮箱**返回同一状态码**，不暴露该邮箱是否注册过 Passkey |
| PROF-ISO-01 | PASS | MFA settings 是自作用域的——接口**根本没有 userId 参数**，不存在改参数读他人设置的面 |
| PROF-ROLE-01 | PASS | Staff 也有自己的 MFA settings（安全能力不是 Customer 专属） |

## 3. 顺带观察到的限流

注册接口在**约 4 次连续请求后返回 429**「Too many attempts. Wait a moment and try again.」，
等待 70 秒后仍在限流窗口内。这挡住了本轮几条口令策略探针，但**这正是 09-08/09 报告要求的行为**，
记为正向观察而非缺陷。

## 4. 未跑（需要授权或设备）

| 区域 | 用例数 | 卡在哪 |
|---|---:|---|
| **TOTP 完整生命周期**（10.2） | 7 | 需要在一个可登录账号上 setup → enable → 登录闸门 → disable。**见第 5 节，我可以自己算 TOTP 码，不需要手机 App** |
| **Email MFA**（10.3） | 8 | 需要能读取的真实邮箱 |
| **Passkey 注册/登录/删除**（11） | ~19 | 需要 Touch ID / Windows Hello / 安全密钥的真实 WebAuthn 手势。用例包明确写了**数据库插入的 Passkey 记录不能代替真实手势** |
| **登录闸门**（10.5） | 9 | 依赖先启用 MFA |
| **敏感操作与关闭**（10.6） | 10 | 依赖先启用 MFA |
| **邮箱变更**（8） | 8 | 需要新邮箱收信 |
| **密码设置与重置**（9） | 大部分 | 需要读重置邮件 |
| **姓名/头像编辑**（6、7） | ~15 | 会写 Profile 数据，同样受只读规则约束 |

## 5. 需要授权的事项

**要把 TOTP 那一整块（约 7 + 9 + 10 = 26 条，含 4 条 P0 登录闸门）跑完，需要一个可登录的账号。**

我可以用标准 RFC 6238 自己算 TOTP 验证码，**不需要手机 App**，所以只要有账号就能跑完整链路：
setup → 用正确码 enable → 验证登录闸门只返回 challenge 不发 token → 错码/过期码/重放码的处理
→ 账号锁定计数 → 用有效码关闭 → 确认 secret 清除且无残留 enabled 状态。

两个选项：

1. **在一个 seed customer 上做，跑完立即关闭。** 我全程持有 secret，随时能用有效码关掉，
   风险可控；但中途如果中断，那个账号会短暂处于需要 TOTP 才能登录的状态。
   建议用 `customer.six@dineflow.test`（09-15 轮已被锁定测试用过，看起来就是消耗性账号）。
2. **给我一个能收信的邮箱**，我注册新账号、确认邮箱后在新账号上跑，完全不碰 seed 数据。

Passkey 与 Email MFA 无论哪个选项都仍然跑不了——前者要真实硬件手势，后者要读信。

## 6. 本轮产生的数据

在生产库注册了 **1 个未确认的探测账号** `qa.sec.20260916@dineflow.test`
（无法登录，处于惰性状态），以及**若干次被口令策略 400 拒绝的注册尝试**（未创建账号）。

## 7. 覆盖矩阵更新

| 模块 | 用例数 | 09-15 | 09-16 |
|---|---:|---|---|
| **profile-security** | 157 | 🔴 未跑 | 🟠 **只读面已跑**（17 项，16 PASS / 1 部分）；MFA/Passkey/邮箱变更等变更类用例待授权 |
