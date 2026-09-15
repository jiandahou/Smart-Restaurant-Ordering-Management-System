# DineFlow Login & Registration 专项测试

测试包：`login-registration`  
调用方式：`$dineflow-system-test 运行 login-registration` 或指定 `LR-*`。  
默认行为：不执行；普通开发、`smoke`、`auth-basic` 和 `email-auth` 不会隐式运行本包。显式运行 `full` 时才与全功能测试合并。

## 专用身份与权限规则

- 密码注册、Google 首次注册/登录和 Magic Link 统一使用 `burnmydread8@gmail.com`。
- 邮箱地址可以作为测试配置记录，但不得保存邮箱/Google 密码、OTP、恢复码、Cookie、Passkey 或其他认证秘密。
- 规划和前置检查时，只可查看本机浏览器 tab 标题判断邮箱服务/Google 会话是否存在；不得打开邮箱或邮件。
- 用户显式要求邮箱相关测试后，可以读取发送到该地址的相关 DineFlow 测试邮件；不得查看无关邮件，不得截取整个收件箱。
- Google 出现密码、CAPTCHA、MFA、Passkey、授权或恢复操作时，由用户完成。
- 如果 DineFlow 测试账号已存在，在显式运行本包时可以先清理，但必须先确认是 local/test 环境并展示规范化邮箱和目标账号。
- 清理只删除 DineFlow 应用账号和测试记录，绝不删除 Gmail/Google 账号或邮箱。优先使用产品 Admin/API 删除；仅在测试环境且必要时使用数据库清理，并记录范围。

## 执行顺序

1. 记录环境、提交、dirty 状态和服务地址。
2. 检查指定 DineFlow 账号是否存在，但不立即删除。
3. 运行不需要账号清理的表单非法/边界/视觉测试。
4. 经显式测试授权后，按场景隔离密码首次注册、Google 首次注册和 Magic Link。
5. 对每个流程分别记录初始、非法、loading、Cancel/Back、Submit/Continue 和最终状态。
6. 测试结束时记录账号是否存在、是否确认、是否关联 Google、是否有 MFA/Passkey 和有效 session。

## 普通注册页面

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-REG-01 | 从登录进入 Create account | 字段为空、条款和社交按钮完整，无演示值 |
| LR-REG-02 | 点击页面左上 Back | 返回登录，不创建账号/请求 |
| LR-REG-03 | 浏览器 Back/Forward | 不意外提交；表单保留策略一致 |
| LR-REG-04 | 点击 Cancel | 返回登录且无副作用 |
| LR-REG-05 | 填写后打开 Customer Terms | 链接可用，不提交注册 |
| LR-REG-06 | 填写后打开 Privacy | 链接可用，不提交注册 |
| LR-REG-07 | 未勾选同意 | Create/Google/Facebook 阻止提交，仅内联说明，无重复 toast |
| LR-REG-08 | 勾选后取消勾选 | 按钮状态立即更新，无网络请求 |
| LR-REG-09 | 键盘完成表单 | 焦点顺序正确、可见、无陷阱 |
| LR-REG-10 | 手机/缩放 | 无溢出、错误和底部按钮可访问 |

## 合法、非法与边界输入

执行前从当前前后端配置读取实际长度和复杂度规则，避免用旧规则当预期。

| Case ID | 字段 | 输入类别 | 预期 |
|---|---|---|---|
| LR-IN-01–02 | Full name | 空、纯空白 | 修剪并拒绝，不请求 |
| LR-IN-03–05 | Full name | 常规、连字符/撇号、中文/重音字符 | 合法姓名安全接受 |
| LR-IN-06 | Full name | 最大长度、最大+1 | 边界一致，无布局破坏 |
| LR-IN-07 | Full name | HTML/script/控制字符 | 不执行、不注入，安全显示或拒绝 |
| LR-IN-08–09 | Email | 空、缺少 @/域名/本地部分、多 @/内部空格 | 前后端一致拒绝 |
| LR-IN-10 | Email | 前后空格、大写 Gmail | 规范化为同一身份 |
| LR-IN-11 | Email | `burnmydread8@gmail.com` | 合法接受 |
| LR-IN-12 | Email | 超长边界 | 安全拒绝/接受，无 500/溢出 |
| LR-IN-13–16 | Password | 空、低于最短、刚好最短、分别缺少字符类别 | 每条规则准确反馈 |
| LR-IN-17 | Password | 前后/内部空格 | 前后端策略一致且明确 |
| LR-IN-18–19 | Password | 长密码边界、Unicode | 不截断、计数一致、无 500 |
| LR-IN-20–21 | Confirm password | 不匹配、粘贴/自动填充匹配 | 不匹配阻止；匹配正确更新 |
| LR-IN-22 | Password UI | 多次点击显示/隐藏 | 值不变、可访问名称正确、无竖条/乱码回归 |

## 普通账号 Submit、Cancel 与错误恢复

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-SUB-01 | 合法表单点击 Create | 单请求、loading/disabled、清楚的确认邮件说明 |
| LR-SUB-02 | Enter 提交 | 与按钮一致，只提交一次 |
| LR-SUB-03 | 双击/连续 Enter | 只创建一个账号和一个有效确认流程 |
| LR-SUB-04 | 提交前 Cancel/Back | 不创建账号或邮件 |
| LR-SUB-05 | Submit 后立即 Back/Refresh | 不重复创建，可恢复状态明确 |
| LR-SUB-06 | 邮箱已存在 | 不重复身份；安全短提示，不显示堆栈 |
| LR-SUB-07 | 绕过 UI 提交非法 payload | 后端拒绝，无半创建账号 |
| LR-SUB-08 | 注册限流 | 429/安全提示，不轰炸账号和邮箱 |
| LR-SUB-09 | 离线/超时 | 不显示假成功；重试不重复 |
| LR-SUB-10 | 409/422/500 | 短错误，无堆栈、密码或敏感信息 |
| LR-SUB-11 | 读取确认邮件 | 只读相关 DineFlow 邮件；收件人、运营主体、链接正确 |
| LR-SUB-12 | 关闭/Cancel 确认页 | 账号保持未确认，可按策略恢复/重发 |
| LR-SUB-13 | 打开确认链接 | 只确认一次，成功后有明确登录路径 |

## Password Login 专项

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-LOGIN-01 | 初始 Password tab | 生产式空值、正确 autocomplete、密码 glyph 正常 |
| LR-LOGIN-02–03 | 正确密码按钮/Enter Submit | 单次登录到正确页面 |
| LR-LOGIN-04 | 空/部分字段 | 内联验证，能在前端阻止则不请求 |
| LR-LOGIN-05–06 | 已存在/不存在邮箱配同一错误密码 | 通用短错误，避免账号枚举 |
| LR-LOGIN-07 | 未确认账号正确密码 | 不给完整 session，提供确认/重发路径 |
| LR-LOGIN-08 | 双击 Submit | 单次有效登录，按钮 loading/disabled |
| LR-LOGIN-09 | 连续失败 | 锁定和限流按策略工作并能恢复 |
| LR-LOGIN-10 | 离线/500 | 短错误，无堆栈，不泄露密码 |
| LR-LOGIN-11 | 未提交时切 Email link/离开 | 不发密码请求，错误状态不串到另一 tab |
| LR-LOGIN-12 | Logout 后 Back/Refresh | 不显示受保护数据，旧 refresh token 不可用 |

## Google 首次注册、Cancel 与 Submit

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-G-01 | 未同意条款点击 Google | 按钮阻止、内联说明、无 OAuth/Toast |
| LR-G-02 | 同意后点击 Google | 只启动一个带 state/correlation 的 OAuth 流程 |
| LR-G-03 | Account chooser 点击 Cancel/Back/Close | 安全返回；无 DineFlow 账号、session、条款记录 |
| LR-G-04 | Google consent 点击 Deny/Cancel | 无账号/session；显示安全重试路径 |
| LR-G-05 | 选择账号并点击 Continue/Submit | 只创建一个 Customer；条款版本/来源记录；正确落地 |
| LR-G-06 | 双击 Continue with Google | 一个有效流程，无重复 popup/state |
| LR-G-07 | 重放 callback URL | 一次性 code/state 拒绝，不生成第二 session |
| LR-G-08 | Correlation/state 失败 | 短错误、可重试、无服务器堆栈 |
| LR-G-09 | Popup/Cookie 限制 | 有操作性恢复说明，无半创建账号 |
| LR-G-10 | 已有 Google DineFlow 账号再次登录 | 同一账号，无重复用户，角色/资料保留 |
| LR-G-11 | 先普通注册同邮箱，再 Google | 安全确定的关联/登录策略，不重复、不接管未验证账号 |
| LR-G-12 | 先 Google 注册，再普通注册同邮箱 | 不重复；明确密码设置/恢复路径 |
| LR-G-13 | Provider 无可用邮箱 | 安全拒绝，无半创建账号 |
| LR-G-14 | Provider timeout/error | 安全错误，能重试，无 correlation 堆栈 |
| LR-G-15 | Logout 后 Google 再登录和 Back | 正确复用账号；退出后不缓存受保护内容 |
| LR-G-16 | Google 前打开 Terms/Privacy 再返回 | 链接可用，未点击 Google 前不启动 OAuth |

## Magic Link（同一邮箱）

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-M-01 | Password ↔ Email link 切换 | 焦点和错误隔离，无请求 |
| LR-M-02 | 输入邮箱后 Cancel/Back | 不发请求/邮件/session |
| LR-M-03 | 空/非法邮箱 Submit | 内联拒绝，能阻止则不请求 |
| LR-M-04 | 合法邮箱 Submit | 单请求、loading/disabled、通用安全说明 |
| LR-M-05 | Enter/双击 Submit | 一个有效请求，不轰炸邮箱 |
| LR-M-06 | 已存在和不存在邮箱 | 公共响应不枚举；未知邮箱不静默注册 |
| LR-M-07 | 高频请求 | IP/收件人限流和安全 UI |
| LR-M-08 | 打开相关 Magic Link 邮件 | 只读最新相关邮件；收件人/运营主体/有效期正确 |
| LR-M-09 | 关闭邮件页不打开链接 | 无 session；链接仍受有效期/单次策略控制 |
| LR-M-10 | 首次打开链接 | 登录正确账号或进入 MFA challenge |
| LR-M-11 | 第二次打开同一链接 | 拒绝重放，无额外 session |
| LR-M-12 | 过期/篡改链接 | 通用错误，无半登录 |
| LR-M-13 | 账号要求 MFA | Magic Link 后仍必须完成 MFA |
| LR-M-14 | 在另一浏览器/tab 打开 | 安全确定的会话交接，原 tab 不错误获得 session |
| LR-M-15 | 请求/回调离线或 500 | 短错误；重试不重复邮件/session |

## 跨方式一致性

| Case ID | 场景 | 预期 |
|---|---|---|
| LR-X-01 | Password/Google/Magic Link 顺序执行 | 规范化邮箱最多一个有效 DineFlow 用户 |
| LR-X-02 | 对比首次注册条款记录 | 版本、时间、来源、用户完整且不重复乱写 |
| LR-X-03 | 开启 MFA 后三种登录 | 任何方式都不能绕过 MFA |
| LR-X-04 | 清理后重新注册 | 无孤儿角色、Token、MFA、Passkey |
| LR-X-05 | 检查截图/Toast/日志 | 无密码、OTP、完整 token、Cookie、堆栈或无关邮箱内容 |

## 手工接力

以下步骤在用户报告观察结果前保持 `BLOCKED` 或 `NOT RUN`，不能由 Agent 自行标记 PASS：

- Google 密码、MFA、CAPTCHA、Passkey、账号恢复或授权确认。
- 确认本机 Google Account chooser 中选择的是指定身份。
- 必须由邮箱所有者确认但未授权 Agent 打开的邮件。
- 任何涉及真实个人 Google 安全设置的变更。
