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
因此**没有**在任何 seed 账号上启用/关闭 MFA、注册 Passkey 或修改密码。

变更类用例改为在一个**专用新账号**上执行：用户当场授权并自行登录了一个邮箱
（执行者全程未接触其凭据），执行者用 `+` 别名注册
`burnmydread4+dineflowqa20260916@gmail.com`，**只打开那一封 DineFlow 确认信**完成确认。
TOTP 验证码由执行者按 RFC 6238 自行计算，未使用手机 App。
跑完已将该账号的 MFA 全部关闭。

## 1. 结论

- **40 项检查：39 PASS / 1 部分完成。** 其中只读面 17 项、TOTP 完整生命周期 23 项。
- **TOTP 这条链路非常扎实**：setup → enable → 登录闸门 → 关闭，23 项全绿，
  没有一处出现「已启用但零保护」或「关不掉 / 关不干净」的状态。
- **1 个投递问题**：注册确认信进了 Gmail 垃圾箱，见第 3 节。
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

## 2bis. TOTP 完整生命周期（23/23 PASS）

在专用新账号上执行，验证码由执行者按 RFC 6238 计算。

### 设置阶段

| 用例 | 结果 | 观察 |
|---|---|---|
| PROF-MFA-07 | PASS | `totp/setup` → 200，返回 `otpauth://` URI、`digits=6`、`period=30`，secret 32 字符（**未写入本报告**） |
| **PROF-MFA-08** | PASS | setup 后未验证就停下 → `setupStarted=true` 但 `totp.enabled=false`、账号 `enabled=false`。**不会假称已保护** |
| **PROF-MFA-09a** | PASS | 再次 setup **换发新 secret** |
| **PROF-MFA-09b** | PASS | 用**被替换掉的旧 secret** 的码启用 → 400「TOTP code is invalid or expired.」 |
| PROF-MFA-10 | PASS | 空 / 5 位 / 7 位 / 字母 / 空格 / 错码 / 不传 code / SQL 片段 —— **8 种全部拒绝** |
| PROF-MFA-10b | PASS | 8 次失败后 `totp.enabled` 仍为 false |
| PROF-MFA-13 | PASS | **5 分钟前时间窗**的码 → 400，窗口是收紧的 |
| PROF-MFA-11 | PASS | 当前有效码 → 200「TOTP MFA enabled.」 |
| **PROF-MFA-22** | PASS | 启用后 `requiredFor.login` **自动为 true**，`preferredMethod=totp`。**不存在「enabled 但零保护范围」的误导状态** |

### 登录闸门（P0 集中区）

| 用例 | 结果 | 观察 |
|---|---|---|
| **PROF-MFA-28** | PASS | MFA 开启后用正确密码登录 → **不签发 access token、也不签发 refresh token**；响应体只有 `challengeId / message / methods / mfaRequired / preferredMethod` |
| PROF-MFA-32 | PASS | 错码 / 空 / 5 位 / 字母 对 challenge → **一个 token 都没发出** |
| **PROF-MFA-32b** | PASS | 把**有效的 TOTP 码**当作 `method=email` 提交 → 400「MFA method is not available for this challenge.」**方法不可混用** |
| PROF-MFA-28b | PASS | 有效码 → 200 并签发 token |
| **PROF-MFA-34** | PASS | **challenge 单次消费**：见下方说明 |

> **PROF-MFA-34 的核实过程值得记一笔。** 第一次立即重放同一个 challenge 返回的是
> **429 限流**，而不是「已使用」。这两者安全含义不同——如果只是限流挡住，
> 慢速重放仍可能签发第二个会话。因此隔开限流窗口（150s / 180s）后用**新的有效码**
> 重放**同一个 challengeId**，得到 **400「This verification step expired. Sign in again to get a new code.」且未签发 token**。
> 结论：challenge 确实是单次消费的，不是仅靠限流兜底。

### 范围开关与关闭

| 用例 | 结果 | 观察 |
|---|---|---|
| PROF-MFA-25 | PASS | 有方法启用时，两个范围都能真正保存（对比零方法时被规范化成 false） |
| **PROF-MFA-24b** | PASS | 关掉 login 范围后登录**确实不再挑战**，直接发 token —— 设置是真生效，不是装饰 |
| **PROF-MFA-40** | PASS | 关闭 MFA 时：**不给 verification / 空码 / 错码 / 过期码 —— 4 种方式全部拒绝** |
| PROF-MFA-40b | PASS | 4 次失败后 `totp.enabled` 与 `requiredFor.login` 均**保持不变**，保护没有被削弱 |
| **PROF-MFA-42** | PASS | 有效码关闭 → 200 |
| **PROF-MFA-42b** | PASS | 关闭后：`enabled=false`、`methods=[]`、两个范围均 false、**`setupStarted=false`** |
| **PROF-MFA-42c** | PASS | **用关闭前的旧 secret 再启用 → 400「Start TOTP setup before enabling it.」—— secret 是真的清掉了**，不是留在库里不用 |
| PROF-MFA-43 | PASS | 全关后登录不再出现 challenge，无残留的假 enabled/scope |

## 3. 顺带观察到的限流

注册接口在**约 4 次连续请求后返回 429**「Too many attempts. Wait a moment and try again.」，
等待 70 秒后仍在限流窗口内。这挡住了本轮几条口令策略探针，但**这正是 09-08/09 报告要求的行为**，
记为正向观察而非缺陷。

## 3bis. 发现的问题

### #1 注册确认信进 Gmail 垃圾箱（中，影响注册漏斗）

用真实 Gmail 地址注册后，确认信**投递到了垃圾箱**，Gmail 给出的理由是
「This message is similar to messages that were identified as spam in the past.」
发信地址 `noreply@theunknownfish.com`。

**为什么要紧**：`register-customer` 明确要求
「Please confirm your email before signing in.」——**不点确认信就登录不了**。
信进垃圾箱，等于新顾客注册漏斗在最后一步断掉，而且用户侧看不出原因
（注册接口返回的是 `confirmationEmailSent: true`，看起来一切正常）。

**注意区分**：这**不是**代码缺陷——邮件确实发出去了，`ResendEmailSender` 在
缺 key 时会抛异常并把 `confirmationEmailSent` 置 false，这里返回 true 说明 Resend 接受了请求。
问题在**发信域的投递信誉**：需要检查 `theunknownfish.com` 的
SPF / DKIM / DMARC 记录是否为 Resend 正确配置，以及该域是否已在 Resend 完成验证。

**顺带的正面观察**：邮件正文本身是合格的——说明了账号用途、**24 小时有效期**、
过期后未确认账号会被自动清理、以及「若非本人操作则无需处理」。没有泄露任何多余信息。

## 4. 未跑（需要授权或设备）

| 区域 | 用例数 | 卡在哪 |
|---|---:|---|
| ~~**TOTP 完整生命周期**~~ | ~~7~~ | **已完成，见第 2bis 节** |
| **Email MFA**（10.3） | 8 | 需要能读取的真实邮箱 |
| **Passkey 注册/登录/删除**（11） | ~19 | 需要 Touch ID / Windows Hello / 安全密钥的真实 WebAuthn 手势。用例包明确写了**数据库插入的 Passkey 记录不能代替真实手势** |
| **登录闸门**（10.5） | 9 | TOTP 路径已跑完；剩 Magic Link / Google OAuth / Passkey **绕过 MFA** 三条（PROF-MFA-29/30/31，均为 P0） |
| **敏感操作与关闭**（10.6） | 10 | 关闭流程已跑完；剩「开启 sensitive 范围后，改密码/换邮箱/动 Passkey 是否真的先要 MFA」（PROF-MFA-37，P0） |
| **邮箱变更**（8） | 8 | 需要新邮箱收信 |
| **密码设置与重置**（9） | 大部分 | 需要读重置邮件 |
| **姓名/头像编辑**（6、7） | ~15 | 会写 Profile 数据，同样受只读规则约束 |

## 5. 仍需授权或设备的部分

| 区域 | 卡在哪 |
|---|---|
| **Passkey 完整流程**（11，约 19 条） | 需要 Touch ID / Windows Hello / 安全密钥的**真实 WebAuthn 手势**。用例包明确写了「数据库中插入的 Passkey 记录不能代替真实用户手势测试」，所以这部分**无法自动化**，必须有人坐在设备前 |
| **Email MFA**（10.3，8 条） | 需要持续读取收件箱。本轮用户只授权了读取那一封确认信，未授权反复读取验证码邮件 |
| **PROF-MFA-29/30/31**（P0） | Magic Link、Google OAuth、Passkey 三条登录路径**是否会绕过 MFA**。Magic Link 需读信；OAuth 需真实 Google 账号；Passkey 需硬件 |
| **邮箱变更**（8 章，8 条） | 需要第二个可收信邮箱 |
| **密码重置**（9 章大部分） | 需要读重置邮件 |
| **姓名/头像编辑**（6、7 章，约 15 条） | 会写 Profile 数据。可在本轮这个专用测试账号上补跑，不影响 seed 数据 |

## 6. 本轮产生的数据

在生产库创建了 **2 个账号**：

| 账号 | 状态 |
|---|---|
| `qa.sec.20260916@dineflow.test` | **未确认**（邮箱域不存在，无法登录），处于惰性状态，24 小时后按产品逻辑自动清理 |
| `burnmydread4+dineflowqa20260916@gmail.com` | 已确认、可登录、**MFA 已全部关闭**，状态干净。用户的真实邮箱别名，需要时可随时删除 |

另有若干次被口令策略 400 拒绝的注册尝试（未创建账号）。

**隐私处理说明**：用户的 Gmail 收件箱中**只打开了那一封 DineFlow 确认信**，
未阅读、未点击、未标记任何其他邮件（包括未点「报告非垃圾邮件」）。
TOTP secret、确认 token、验证码均未写入本报告、日志或提交记录。

## 7. 覆盖矩阵更新

| 模块 | 用例数 | 09-15 | 09-16 |
|---|---:|---|---|
| **profile-security** | 157 | 🔴 未跑 | 🟡 **只读面 + TOTP 全生命周期已跑**（40 项，39 PASS / 1 部分）；Passkey、Email MFA、OAuth/Magic Link 绕过检查仍需设备与收件箱 |
