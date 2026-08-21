# DineFlow Profile 与账号安全专项测试用例

测试包名称：`profile-security`  
稳定用例前缀：`PROF-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `profile-security`、某个 `PROF-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/me` User Center，包括：资料显示、姓名编辑、头像、邮箱变更、密码、MFA、Passkey、会话、审计、并发和故障恢复。MFA 是本包的重点，必须同时验证 UI、API、数据库、登录闸门和敏感操作，不能仅根据开关或 Toast 判定通过。

## 1. 执行规则与安全边界

- 只允许在明确的 local/test 环境执行可变更数据的用例；生产环境只允许只读检查，除非用户另行明确授权。
- 优先通过 UI/API 建立状态。遇到测试卡点时，用户允许在 local/test 数据库中创建、修改或恢复**精确测试账号**的 Profile、MFA、Passkey、确认状态、登录绑定和会话数据。
- 动数据库前必须记录：环境、标准化邮箱、UserId、角色、邮箱确认、MFA 设置、Passkey 数量、活动 Refresh Token 数量和待修改字段；结束后恢复或明确记录最终状态。
- 不得删除或修改 Google/Facebook 身份、邮箱本身、系统 Passkey 或生产数据。数据库中插入的 Passkey 记录不能代替真实 WebAuthn 用户手势测试。
- 邮箱密码、OTP、TOTP secret、二维码内容、恢复码、Magic Link、Cookie、Access/Refresh Token、Passkey credential 不得写入报告、日志或截图。
- 邮件相关步骤只查看本次 DineFlow 测试邮件；打开邮箱、读取验证码或确认链接前必须得到该次运行的用户授权。
- TOTP、邮箱 OTP、Touch ID、Windows Hello、安全密钥、Google OAuth 和系统权限弹窗允许用户接力。没有用户实际完成时不得标记 `PASS`。
- 测试请求发送、取消、重复点击、刷新和并发时，必须检查数据库实际写入次数，不能只看按钮状态。
- 本包是专项回归，不自动扩展到支付、订单、打印或全系统测试。

## 2. 推荐账号与夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| Primary Customer | 已确认邮箱、有密码、无初始 MFA/Passkey | 大部分 Profile 与安全用例 |
| Social-only Customer | 已确认邮箱、有 Google/Facebook 登录、无本地密码 | Set password、邮箱变更和外部登录标识 |
| Secondary Customer | 不同邮箱，账号已存在 | 重复邮箱和租户/账号隔离 |
| Non-Customer | 至少一个 Owner/Admin/Staff | Profile 编辑权限边界 |
| New email mailbox | 可接收本次 DineFlow 测试邮件 | 邮箱变更确认 |
| TOTP app | Google Authenticator、1Password 等 | TOTP 设置与验证 |
| Passkey device | Touch ID、Windows Hello 或安全密钥 | WebAuthn 注册/登录/删除 |
| PostgreSQL test DB | 可查询并发写入和审计 | MFA 唯一记录、会话与清理验证 |

如果缺少新邮箱、TOTP app 或 Passkey 设备，执行前必须列出受影响用例并让用户准备；其余不受影响的用例继续执行。

## 3. 状态定义

- `PASS`：预期结果已直接观察，并在需要时用 API/数据库交叉验证。
- `FAIL`：实际行为与预期不一致，需建立问题记录和复测编号。
- `BLOCKED`：已开始执行，但被第三方、设备、权限或环境阻止。
- `NOT RUN`：本轮主动未执行，必须记录原因和完成者。

## 4. 前置检查

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-PRE-01 | P1 | 项目目录 | 记录分支、提交、dirty 数量、Node/.NET 版本、环境和服务地址 | 不覆盖用户改动；环境明确不是生产误用 | Auto |
| PROF-PRE-02 | P1 | Primary Customer | 精确解析标准化邮箱、UserId、角色、确认状态和是否有密码/外部登录 | 只解析一个目标账号；无歧义 | Auto |
| PROF-PRE-03 | P1 | PostgreSQL | 记录该用户 MFA 行、Passkey、活动 Refresh Token、邮箱、姓名、头像和审计基线 | 不输出 Secret、TokenHash、CredentialId/PublicKey | Auto |
| PROF-PRE-04 | P1 | 邮件类用例 | 确认本次获准使用的邮箱和 DineFlow 邮件过滤规则 | 缺授权时提前标出，不打开邮箱 | Assisted |
| PROF-PRE-05 | P1 | TOTP/Passkey 类用例 | 确认 TOTP app、Passkey 设备和用户手势是否可用 | 缺设备时提前列出受影响编号 | Assisted |
| PROF-PRE-06 | P2 | 数据可恢复 | 制定结束状态：邮箱、姓名、头像、MFA、Passkey、活动会话 | 每个可变更用例都有清理或明确保留决定 | Auto |

## 5. 页面、访问与资料显示

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-PAGE-01 | P1 | 未登录 | 直接打开 `/me`，刷新并后退 | 跳转登录；无姓名、邮箱、角色或头像数据闪现 | Auto |
| PROF-PAGE-02 | P1 | Customer | 登录后从用户菜单打开 Profile | 唯一 H1 为 User Center；显示头像、姓名、邮箱、Restaurant、Roles 和 Security | Auto |
| PROF-PAGE-03 | P2 | Platform scope Customer | 查看 Restaurant | 明确显示 Platform scope，不显示错误餐厅 | Auto |
| PROF-PAGE-04 | P1 | 有 restaurantId 的账号 | 打开页面并等待餐厅名称加载 | 显示正确餐厅；加载失败只回退到 Assigned restaurant，不泄露其他餐厅 | Auto |
| PROF-PAGE-05 | P1 | Customer | 刷新页面、浏览器前进/后退、重新进入 | 数据一致；不重复提交任何变更 | Auto |
| PROF-PAGE-06 | P1 | Owner/Admin/Staff | 打开 `/me` 并尝试 Edit name、Change email 和直接调用对应 API | 非 Customer 不能使用 Customer 自助资料/邮箱修改；返回 403 且无局部写入 | Auto |
| PROF-PAGE-07 | P2 | 长姓名/邮箱/多角色 | 桌面、窄宽和 200% zoom 查看并聚焦溢出字段 | 无横向溢出；Tooltip 可通过鼠标和键盘访问；按钮不被挤压 | Assisted |
| PROF-PAGE-08 | P1 | API 故障夹具 | 让 `/me`、餐厅名称、MFA 设置或 Passkey 列表返回 401/403/500 | 页面不显示堆栈、Token 或旧用户数据；错误简短可恢复 | Auto |

## 6. 姓名编辑

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-NAME-01 | P1 | Customer | 点击 Edit，输入正常姓名并 Save | UI、Redux、`GET /me` 和数据库一致；记录审计 | Auto |
| PROF-NAME-02 | P2 | Customer | 修改后点 Cancel | 恢复原值；无 API 请求和数据库写入 | Auto |
| PROF-NAME-03 | P2 | Customer | 修改后按 Escape/关闭页面，再返回 | 未保存内容不持久化 | Auto |
| PROF-NAME-04 | P1 | Customer | 输入空字符串、空格、Tab/换行组合 | 前后端均拒绝；不能保存空白姓名 | Auto |
| PROF-NAME-05 | P2 | Customer | 输入前后空格和连续内部空格 | 按统一规范化规则保存；刷新后不反复变化 | Auto |
| PROF-NAME-06 | P2 | Customer | 输入中文、重音字符、撇号和连字符 | 正常保存且不乱码 | Auto |
| PROF-NAME-07 | P1 | Customer | 输入最大允许长度和超出一字符 | 边界值成功；超长前后端一致拒绝且不截断成另一姓名 | Auto |
| PROF-NAME-08 | P1 | Customer | 输入 HTML、脚本、双向控制符和异常 Unicode | 作为文本处理；无脚本执行、日志注入或布局破坏 | Auto |
| PROF-NAME-09 | P2 | Customer | 按 Enter 保存并快速双击 Save | 只产生一次最终变更和合理数量审计；按钮有提交状态 | Auto |
| PROF-NAME-10 | P1 | 两个同账号标签页 | A、B 同时编辑不同姓名并保存 | 行为确定且可解释；不得出现半写入或 UI 显示与 DB 不一致 | Auto |

## 7. 头像

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-AV-01 | P2 | 无头像账号 | 打开 Profile | 显示由姓名/邮箱生成的安全 initials；空值有 U 回退 | Auto |
| PROF-AV-02 | P1 | 小于 2MB 的 JPG | 上传并刷新 | 上传成功；头像 URL 属于当前用户；`GET /me` 和页面一致 | Auto |
| PROF-AV-03 | P1 | 小于 2MB 的 PNG/WebP | 分别上传 | 两种格式均可用；图片比例不破坏布局 | Auto |
| PROF-AV-04 | P1 | 恰好 2MB 和大于 2MB 一字节 | 分别上传 | 2MB 边界按政策处理；超出明确拒绝且旧头像保留 | Auto |
| PROF-AV-05 | P1 | GIF/SVG/PDF/文本 | 通过文件选择器和直接 API 上传 | 前后端均拒绝；SVG 脚本不得进入公开目录 | Auto |
| PROF-AV-06 | P1 | MIME 伪装/损坏图片 | 使用图片扩展名但错误内容或 Content-Type | 服务端验证实际可用图片；不能存储可执行/损坏内容 | Auto |
| PROF-AV-07 | P1 | 已有头像 | 上传第二张 | 新头像生效；旧的本系统头像安全删除，不删除其他用户文件 | Auto |
| PROF-AV-08 | P1 | 两个用户 | 尝试用 A 的 complete objectKey 更新 B，或构造路径穿越 key | 返回拒绝；不能读取、覆盖或删除另一用户头像 | Auto |
| PROF-AV-09 | P2 | 上传中 | 双击 Upload/重复完成回调/刷新页面 | 至多一个最终头像；无孤儿状态、重复审计或错误删除 | Auto |
| PROF-AV-10 | P2 | S3 与本地存储模式 | 分别验证 upload-url/complete 和 multipart 回退 | 客户端选择正确路径；错误只显示简短信息，不展示存储凭据或堆栈 | Auto |
| PROF-AV-11 | P2 | 断网/上传超时 | 上传中断后重试 | 旧头像保留；按钮恢复；重试可成功 | Auto |

## 8. 邮箱变更

邮箱变更是账号恢复路径，必须重点验证当前密码、MFA、确认链接、会话撤销和审计。

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-EMAIL-01 | P1 | Customer、有密码、无敏感操作 MFA | 输入可用新邮箱和正确当前密码，发送验证 | 只向新邮箱发送一次 DineFlow 确认；当前邮箱暂不改变 | Assisted |
| PROF-EMAIL-02 | P1 | 同上 | 输入空值、非法邮箱、内部空格、超长邮箱 | 前后端一致拒绝；不发送邮件 | Auto |
| PROF-EMAIL-03 | P1 | 同上 | 输入与当前邮箱仅大小写不同或规范化后相同 | 拒绝“新邮箱必须不同”；不发送邮件 | Auto |
| PROF-EMAIL-04 | P1 | Secondary Customer | 使用已存在邮箱 | 拒绝且不泄露对方资料；当前账号不变 | Auto |
| PROF-EMAIL-05 | P1 | Customer | 使用错误当前密码和空密码 | 通用安全错误；不发送邮件、不增加异常详情 | Auto |
| PROF-EMAIL-06 | P1 | 已启用 Sensitive actions MFA | 正确密码但不提交 MFA、提交错误/过期 MFA | 拒绝；新邮箱不收到确认；无任何账号变更 | Auto/Assisted |
| PROF-EMAIL-07 | P1 | 已启用 Sensitive actions MFA | 正确密码和有效 TOTP/Email code | 发送确认邮件；MFA code 按策略单次使用 | Assisted |
| PROF-EMAIL-08 | P2 | 邮箱表单 | 输入后 Cancel、关闭 MFA 对话框、返回页面 | 清空密码和待提交值；不发送邮件 | Auto |
| PROF-EMAIL-09 | P1 | 新邮箱收件箱 | 打开邮件，检查收件人、旧/新邮箱说明、有效期和链接域名 | 内容明确；链接指向正确前端；无密码、OTP 或内部主机名 | Assisted |
| PROF-EMAIL-10 | P1 | 有效确认链接 | 首次打开 | Email 与 UserName 原子更新；EmailConfirmed 正确；审计记录旧/新值 | Assisted |
| PROF-EMAIL-11 | P1 | 已使用链接 | 再次打开、篡改 token/newEmail/userId | 通用无害失败；不能改到攻击者邮箱；无 500/堆栈 | Assisted |
| PROF-EMAIL-12 | P1 | 多活动会话 | 确认新邮箱后，在旧标签页/API 使用旧 Access/Refresh Token | 按安全戳策略旧会话失效；必须用新邮箱重新登录 | Auto/Assisted |
| PROF-EMAIL-13 | P1 | Social-only Customer | 尝试 Change email | 不因没有本地密码而进入死路；应提供可解释的重新认证/设置密码路径 | Assisted |
| PROF-EMAIL-14 | P1 | 邮件服务失败 | 让发送邮件失败 | 当前邮箱不变；前端只显示简短错误，绝不能显示 SMTP/provider 异常 `detail` | Auto |
| PROF-EMAIL-15 | P2 | 重复点击/两个标签页 | 并发请求两个不同新邮箱并分别确认 | 最终邮箱唯一确定；旧 Token 不能覆盖较新的已确认变更；审计完整 | Assisted |

## 9. 密码设置与重置

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-PWD-01 | P1 | 有密码、未启用 Sensitive actions MFA | 点击 Reset my password | 只发送一次验证过的重置邮件；页面不显示 Token | Assisted |
| PROF-PWD-02 | P1 | Social-only Customer | 点击 Set password | 提供安全设置路径；完成后保留外部登录并可用密码登录 | Assisted |
| PROF-PWD-03 | P1 | 已启用 Sensitive actions MFA | 点击 Change password | 先输入符合政策的新密码，再要求有效 MFA，验证前不写密码 | Assisted |
| PROF-PWD-04 | P1 | 密码对话框 | 测试空值、过短、缺字符类别、超长和确认不一致 | 前后端一致拒绝；密码始终遮罩 | Auto |
| PROF-PWD-05 | P2 | 密码对话框 | Cancel、关闭 MFA、刷新 | 草稿密码清空；无更新、无邮件 | Auto |
| PROF-PWD-06 | P1 | Sensitive actions MFA | 错误/过期/复用 MFA code | 密码不变；Code 失败安全且受尝试限制 | Assisted |
| PROF-PWD-07 | P1 | 有效 MFA | 修改密码并登出 | 新密码可登录；旧密码失败；审计不含密码 | Assisted |
| PROF-PWD-08 | P1 | 多活动会话 | 修改密码后在另一标签页使用旧 Refresh Token | 按安全政策撤销或失效；不能长期保留被盗会话 | Auto |
| PROF-PWD-09 | P1 | 重置邮件 | 首次使用、重复使用、篡改和过期 | 首次成功；其余通用失败；无部分更新 | Assisted |
| PROF-PWD-10 | P2 | 快速点击 | 双击 Reset/Change/Continue | 至多一次邮件或最终更新；按钮有 loading 状态 | Auto/Assisted |
| PROF-PWD-11 | P2 | 非 Customer | 打开 Profile Password 区域并直接调用 Customer reset API | UI 不误导；API 按角色/政策安全处理 | Auto |
| PROF-PWD-12 | P1 | API 故障 | 模拟 400/401/429/500 | Toast 简短，不显示 Identity errors、堆栈、密码或 Token | Auto |

## 10. MFA 设置与验证（重点）

### 10.1 默认状态、读取与并发

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-01 | P1 | DB 中无 UserMfaSettings | 连续两次 GET settings，并打开/刷新 Profile | 返回相同默认设置；GET 不写数据库 | Auto |
| PROF-MFA-02 | P1 | 未登录/过期 Token | GET/PUT settings 和 setup/disable API | 401；不创建 MFA 行、不发邮件 | Auto |
| PROF-MFA-03 | P1 | 无设置行，PostgreSQL | 两个请求同时首次 PUT settings | 只生成一行；无 PK 冲突、500 或堆栈；最终状态确定 | Auto |
| PROF-MFA-04 | P1 | 无设置行，PostgreSQL | setup TOTP 与 PUT settings 并发首次创建 | 只生成一行；Secret 和 scope 不丢失；无重复审计 | Auto |
| PROF-MFA-05 | P2 | 无 MFA | 查看折叠和展开摘要 | 显示 Not enabled；方法关闭；Login/Sensitive actions 开关禁用 | Auto |
| PROF-MFA-06 | P1 | API 直接调用 | 没有启用方法时尝试把 Login/Sensitive actions 设为 true | API 不得声称账号受保护；应拒绝或规范化为 false | Auto |

### 10.2 TOTP 设置

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-07 | P1 | 已确认账号 | 开启 Authenticator app | 显示 QR、Manual key、6 位输入；Secret 不进入普通日志/截图 | Assisted |
| PROF-MFA-08 | P1 | TOTP setup 对话框 | 未验证就 Cancel/关闭/刷新 | TOTP 仍未 enabled；页面不显示 Protected | Auto |
| PROF-MFA-09 | P1 | 上次 setup 未完成 | 再次开始 setup | 新 Secret/二维码替换旧值；旧 Secret 不能启用 | Assisted |
| PROF-MFA-10 | P1 | TOTP setup | 输入空、非数字、5 位、7 位、错误码、过期码 | 就地拒绝；不启用；无服务器细节 | Auto/Assisted |
| PROF-MFA-11 | P1 | TOTP app | 输入当前有效码 | TOTP enabled、preferredMethod 正确；至少一个保护 scope 开启；TwoFactorEnabled 一致 | Assisted |
| PROF-MFA-12 | P1 | 已启用 TOTP | 刷新页面、重新登录、查询 DB | UI、API、UserMfaSettings 和 Identity TwoFactorEnabled 一致 | Auto/Assisted |
| PROF-MFA-13 | P2 | 时间边界 | 在 30 秒窗口前后和允许的网络延迟窗口验证 | 仅接受政策窗口内的码；旧窗口安全失败 | Assisted |

### 10.3 Email MFA

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-14 | P1 | 未确认邮箱 | 调用 email/setup | 拒绝并提示先确认邮箱；不发信、不建 enabled 状态 | Auto |
| PROF-MFA-15 | P1 | 已确认邮箱且获准访问收件箱 | 开启 Email code | 只发送相关 DineFlow 邮件；说明用途、10 分钟有效期和不得分享 | Assisted |
| PROF-MFA-16 | P1 | Email setup 对话框 | Cancel/关闭而不输入 code | Email MFA 未启用；无 Protected 假状态 | Auto |
| PROF-MFA-17 | P1 | Email setup | 输入空、非数字、错误、过期 code | 就地拒绝；不启用；不显示完整后端异常 | Assisted |
| PROF-MFA-18 | P1 | 有效 Email code | 首次提交后再次提交同一码 | 首次启用；第二次失败；Code 单次消费 | Assisted |
| PROF-MFA-19 | P1 | 连续请求 setup code | 请求两次后先用旧码再用新码 | 旧码失效；仅最新码可用；邮件可区分时间 | Assisted |
| PROF-MFA-20 | P1 | 邮件滥用测试 | 快速重复 email/setup 和 sensitive/email-code | 按用户/IP/收件人限流；429 和 Retry-After；不能轰炸邮箱 | Auto/Assisted |
| PROF-MFA-21 | P1 | 服务重启/多 API 副本 | 发码后重启或在另一副本验证 | 行为符合明确策略；若内存存储导致失效，UI 能解释并允许安全重发 | Manual |

### 10.4 方法组合与保护范围

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-22 | P1 | 首次启用任一 MFA | 完成 TOTP 或 Email MFA | 默认至少启用 Login 保护；不出现 enabled 但零保护范围的误导状态 | Auto/Assisted |
| PROF-MFA-23 | P1 | TOTP + Email 均启用 | 查看摘要和敏感操作对话框 | 两个方法可选；preferredMethod 默认选中；切换会清空旧 code | Assisted |
| PROF-MFA-24 | P1 | 已启用 MFA | 开关 Login，刷新并查询 DB | UI/API/DB 一致；保存中禁用重复操作；有审计 | Auto |
| PROF-MFA-25 | P1 | 已启用 MFA | 开关 Sensitive actions，刷新并查询 DB | UI/API/DB 一致；实际敏感操作遵守设置 | Auto |
| PROF-MFA-26 | P1 | 两个标签页 | A/B 同时修改不同 scope | 无 PK/并发异常；最终 UI 与 DB 一致；不会静默丢失方法状态 | Auto |
| PROF-MFA-27 | P1 | API 构造 | 尝试设置未实现的 payment scope 或额外字段 | Payment 不被虚假标为受保护；未知字段不改变安全状态 | Auto |

### 10.5 登录闸门

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-28 | P0 | RequireForLogin=true | 正确密码登录 | 只返回 challengeId/methods，不签发完整 Access/Refresh Token | Auto/Assisted |
| PROF-MFA-29 | P0 | 同上 | 使用 Magic Link 登录 | Magic Link 不能绕过 MFA；验证前无活动 Refresh Token | Assisted |
| PROF-MFA-30 | P0 | 同上、Google 可用 | Google 登录/现有账号关联登录 | OAuth 不能绕过 MFA；验证前无应用会话 | Assisted |
| PROF-MFA-31 | P0 | 同上、已注册 Passkey | Passkey 登录 | 必须符合明确安全策略：继续 MFA，或把已验证 Passkey 明确作为满足 MFA；不得悄悄绕过页面承诺 | Assisted |
| PROF-MFA-32 | P1 | 登录 challenge | 空/错误/过期 code 和错误 method | 通用失败；不签发 Token；错误次数计入账号锁定 | Auto/Assisted |
| PROF-MFA-33 | P1 | 登录 challenge | 连续错误达到阈值后输入正确 code | 账号锁定并拒绝正确 code，直到锁定解除 | Auto/Assisted |
| PROF-MFA-34 | P1 | 登录 challenge | 正确 code 双击、回放 challenge、在另一标签页复用 | 只产生一个会话；challenge 单次消费 | Auto/Assisted |
| PROF-MFA-35 | P1 | 5 分钟过期夹具 | 过期后验证 | 通用过期错误；无部分登录；可以重新发起登录 | Auto/Assisted |
| PROF-MFA-36 | P1 | Email 登录 MFA | 检查验证码邮件和重发 | Code 与当前 challenge 绑定；旧 challenge/code 不可串用；邮件请求有限流 | Assisted |

### 10.6 敏感操作、关闭与恢复

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-MFA-37 | P0 | RequireForSensitiveActions=true | 换邮箱、改密码、添加/重命名/删除 Passkey | 每个操作在有效 MFA 前均无数据写入 | Auto/Assisted |
| PROF-MFA-38 | P1 | Sensitive action 对话框 | Cancel、错误/过期/复用 code、切换方法 | 操作不发生；Code 处理一致；无敏感内容残留 | Auto/Assisted |
| PROF-MFA-39 | P1 | Email sensitive code | 连续发送、失败、重试 | 有限流；只有最新有效 Code 可用；Toast 不展示 OTP/堆栈 | Assisted |
| PROF-MFA-40 | P0 | 已启用一个或两个方法 | 关闭单一方法但不给 MFA/给错误 MFA | 拒绝；不能降低保护；原方法和 scope 保留 | Auto/Assisted |
| PROF-MFA-41 | P1 | TOTP + Email | 用有效另一方法关闭 preferredMethod | 剩余方法自动成为 preferred；保护 scope 保持；登录仍可完成 | Assisted |
| PROF-MFA-42 | P0 | 只剩一个方法 | Disable all，分别测试 Cancel、错误 code、有效 code | 仅有效验证后全部关闭；Secret 清除、TwoFactorEnabled=false、所有 scope=false、审计存在 | Assisted |
| PROF-MFA-43 | P1 | 关闭全部后 | 刷新、登出、密码/Magic 登录、敏感操作 | 不再出现 MFA challenge；DB 无残留 enabled/scope 假状态 | Auto/Assisted |
| PROF-MFA-44 | P1 | 用户丢失设备 | 使用仍可用的另一 MFA 方法关闭丢失方法 | 可安全恢复且不关闭剩余保护 | Assisted |
| PROF-MFA-45 | P1 | 用户失去全部 MFA | 检查产品恢复流程和管理员能力 | 不允许仅凭未验证邮箱直接关闭；恢复需要明确、审计和人工政策 | Manual |
| PROF-MFA-46 | P1 | 审计权限 | 查看 MFA setup/enabled/settings/disabled/login success 日志 | 时间、用户、方法和范围正确；不含 Secret、QR、OTP 或 Token | Auto |

## 11. Passkey

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-PK-01 | P1 | 无 Passkey | 展开列表 | 显示空状态；只查询当前用户；无 DB 写入 | Auto |
| PROF-PK-02 | P0 | RequireForSensitiveActions=true | 点击 Add passkey，不给/给错误 MFA | WebAuthn 系统弹窗前即被 MFA 拦截；不创建 options/credential | Auto/Assisted |
| PROF-PK-03 | P1 | Passkey 设备 | 有效 MFA 后注册首个 Passkey | 必须有用户手势；创建一条当前用户凭据；显示名称和 Created 时间 | Assisted |
| PROF-PK-04 | P2 | 注册弹窗 | 用户取消 Touch ID/Windows Hello/安全密钥 | 简短可重试错误；数据库无凭据 | Assisted |
| PROF-PK-05 | P1 | 已注册凭据 | 尝试重复注册同一 credential | 被 exclude/unique 规则拒绝；无重复行 | Assisted |
| PROF-PK-06 | P1 | 注册 options | 过期、回放、在另一用户会话完成 | 通用失败；不能把凭据绑定给错误用户 | Auto/Assisted |
| PROF-PK-07 | P2 | 已注册 Passkey | 重命名为空、前后空格、120/121 字符、Unicode | 空值明确拒绝；规范化和最大长度前后端一致 | Auto/Assisted |
| PROF-PK-08 | P0 | 两个用户 | A 尝试 PUT/DELETE B 的 passkeyId | 404/拒绝；不泄露 B 的凭据存在性；无修改 | Auto |
| PROF-PK-09 | P1 | 已注册 Passkey | 删除弹窗 Cancel，再有效删除 | Cancel 不变；删除需要敏感操作 MFA；成功后列表和 DB 同步 | Assisted |
| PROF-PK-10 | P1 | 删除后的 Passkey | 登出并尝试登录 | 通用失败；不能恢复已删除凭据；保留的其他凭据仍可用 | Assisted |
| PROF-PK-11 | P1 | 两台设备/两个凭据 | 注册两个、使用其中一个、刷新列表 | Created/Last used/Synced 元数据准确；凭据彼此独立 | Assisted |
| PROF-PK-12 | P1 | 锁定账号 | 用有效 Passkey 登录 | 遵守账号锁定，返回 423；不创建会话 | Assisted |
| PROF-PK-13 | P0 | 未确认/禁用/已删除用户 | 用其 Passkey 登录 | 拒绝且不泄露账号状态；无会话 | Assisted |
| PROF-PK-14 | P1 | 审计权限 | 注册、重命名、删除、登录后查看审计 | 不记录 CredentialId、PublicKey、challenge 或 assertion；事件主体正确 | Auto |

## 12. 恢复、审计、隐私与整体质量

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| PROF-REC-01 | P1 | 每种资料/安全操作 | 对比成功、失败和取消后的 ReportLog/Audit | 只为实际安全事件写合适日志；无密码、OTP、Secret、Token 或邮件链接 | Auto |
| PROF-REC-02 | P1 | 401/403/400/429/500 夹具 | 检查所有 Profile Toast 和表单 root error | 只显示短消息；绝不展示服务器堆栈、SQL、SMTP detail 或内部地址 | Auto |
| PROF-REC-03 | P2 | 键盘 | 仅用键盘完成姓名编辑、MFA 展开、方法切换、Cancel 和 Passkey 列表 | 焦点可见、顺序合理、无陷阱；Dialog 关闭后焦点返回触发器 | Assisted |
| PROF-REC-04 | P2 | 屏幕阅读器 | 检查 H1、Switch、Badge、Dialog、错误和 loading 状态 | 名称/状态可读；开关不能只靠颜色；错误与输入关联 | Assisted |
| PROF-REC-05 | P1 | 手机 Safari/Chrome、平板 | 打开 Profile、MFA/TOTP/Email/Password/Passkey 对话框 | 无横向溢出；QR、Manual key、输入和底部按钮均可访问 | Assisted |
| PROF-REC-06 | P1 | 中断夹具 | 在 Profile 保存、发码、MFA 开关和 Passkey 操作中刷新/断网 | 恢复后以服务器状态为准；不出现 Protected 假状态或重复写入 | Auto/Assisted |
| PROF-REC-07 | P1 | 数据库 | 测试结束查询精确账号 | 姓名/邮箱/头像/MFA/Passkey/会话符合预定结束状态；无孤儿行 | Auto |
| PROF-REC-08 | P1 | 测试报告 | 审查截图、日志、CSV 和报告 | 不含邮箱无关内容、密码、OTP、TOTP Secret、QR、Token、Cookie、PublicKey 或完整认证链接 | Auto |

## 13. 推荐执行顺序

1. `PROF-PRE-*` 和 `PROF-PAGE-*`。
2. 姓名、头像和无状态的负向验证。
3. MFA 默认读取与 PostgreSQL 并发用例。
4. TOTP 设置、Email MFA、方法组合和 scope。
5. 登录闸门：Password、Magic Link、Google、Passkey。
6. 敏感操作：邮箱、密码和 Passkey 管理。
7. MFA 关闭和恢复。
8. 邮箱确认、会话撤销及破坏性更高的账号变更。
9. 审计、响应式、可访问性和清理。

这样可以避免过早修改主邮箱或密码导致后续用例全部阻塞。

## 14. 用户接力清单

执行到以下步骤时暂停并告诉用户准确操作，不要求用户在聊天中提供 Secret：

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| TOTP | 扫描当前测试 QR，并在页面输入当前 6 位码 | UI/API/DB enabled、scope、登录闸门和审计 |
| Email MFA | 在获准邮箱中只查看最新 DineFlow MFA 邮件，并在页面输入 code | Code 单次/过期/重发、无会话绕过 |
| Email change | 打开新邮箱中的本次 DineFlow 确认链接 | Email/UserName、确认状态、旧会话、审计 |
| Passkey | 完成或取消 Touch ID/Windows Hello/安全密钥提示 | DB 行、列表、登录、删除和审计 |
| Google 登录闸门 | 完成 Provider 密码/同意/CAPTCHA/MFA | OAuth 后仍遵守 DineFlow MFA policy |

## 15. 数据库夹具与清理模板

数据库操作仅用于 local/test 卡点，报告必须记录原因和 SQL 影响行数。允许的精确夹具包括：

- 为目标用户创建/删除一行 `UserMfaSettings`；
- 切换 `TotpEnabled`、`EmailEnabled`、`PreferredMethod` 和 `RequireFor*` 以到达指定起点；
- 清除测试产生的锁定状态和 AccessFailedCount；
- 查询/撤销目标用户测试 Refresh Token；
- 查询或删除**测试过程中创建**的 Passkey 行；
- 恢复测试前姓名、邮箱、确认状态、头像和 SecurityStamp 相关状态。

不得把伪造的 TOTP Secret、Email code 或 Passkey credential 当成真实用户手势的通过证据。数据库只用于建立起点、解除卡点和验证后置状态。

## 16. 证据建议

- `001-profile-baseline.png`：User Center 基线。
- `002-profile-name-validation.png`：姓名边界/错误。
- `003-profile-avatar-validation.png`：头像格式/大小错误。
- `004-profile-email-change-mfa.png`：邮箱变更 MFA 闸门，不含 code。
- `005-profile-mfa-default.png`：无 MFA 默认状态。
- `006-profile-totp-setup-redacted.png`：TOTP 对话框；必须遮盖 QR 和 Manual key。
- `007-profile-email-mfa-enabled.png`：Email MFA enabled 状态，不含 OTP。
- `008-profile-login-mfa-challenge.png`：验证前无完整会话。
- `009-profile-sensitive-action-gate.png`：敏感操作 MFA 对话框。
- `010-profile-passkey-list.png`：Passkey 名称和日期；不含 credential 数据。
- `logs/profile-database-checks.md`：仅记录计数、布尔状态和脱敏审计结果。

## 17. 完成标准

- 所有被选用例都有 `PASS`、`FAIL`、`BLOCKED` 或 `NOT RUN`。
- 每个 FAIL 都有独立问题编号、优先级、建议修复和复测用例。
- P0 代表可能绕过 MFA、接管账号或跨用户修改安全凭据；任何 P0 未关闭时不得认为 Profile 安全功能可上线。
- 最终账号状态、MFA 行、Passkey 数量和活动会话数已记录。
- 所有临时数据库状态已恢复或经用户明确选择保留。

