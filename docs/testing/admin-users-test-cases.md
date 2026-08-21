# DineFlow Admin Users 专项测试用例

测试包名称：`admin-users`  
稳定用例前缀：`USR-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-users`、某个 `USR-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/admin/users` 的三个分区：**Users 目录**（搜索、筛选、排序、分页、选择、批量操作、行内编辑与账号状态）、**Create user**（建号与临时密码/设置邮件）、**Email test**（发信连通性）。它是独立的部分功能测试，不自动扩展到登录/注册流程、个人资料安全设置、Dashboard、订单履约或支付。

相邻测试包，不要在本包内重复覆盖：
- 登录、注册、验证码与 MFA 挑战本身 → [login-registration-test-cases.md](login-registration-test-cases.md)
- 用户自己的资料、改邮箱、passkey、MFA 设置 → [profile-security-test-cases.md](profile-security-test-cases.md)
- Dashboard 指标与 Widget → [dashboard-test-cases.md](dashboard-test-cases.md)

## 1. 执行与安全规则

- **只在 Local/Test/Staging 执行写操作。** 本包的删除、禁用、改角色、改餐厅归属和批量操作都会真实改变账号可用性，Production 默认只读。
- 本包会**向真实邮箱发信**（密码重置、密码设置邮件、Email test）。只允许使用测试收件箱；不得对真实员工或顾客账号触发。
- 测试前记录并在结束时恢复：每个被操作账号的 `roles`、`restaurantId`、`isDisabled`、`lockoutEnd`、`accessFailedCount`、`emailConfirmed`、`twoFactorEnabled`，以及被创建账号的清理责任人。
- **删除用例默认使用一次性账号**，不得对夹具账号执行删除后再重建——重建后的 UserId 不同，会污染后续用例的越权断言。
- 越权用例必须使用 A/B 两个明确不同餐厅的真实账号，不能只根据前端按钮是否隐藏判断通过；每条 P0 越权用例都要求**直接调用 API** 复核。
- 报告不得包含密码、临时密码、重置链接完整 Token、Cookie、Access/Refresh Token 或真实顾客邮箱全文（可打码）。
- 本文件只定义用例；增加或修改用例不会自动开始浏览器操作。

## 2. 角色与可操作范围（先读这一节）

后端的判定集中在 `ResolveManageableTargetAsync`，四条守卫按顺序生效，用例的预期都以它为准：

| 顺序 | 守卫 | 拒绝码 | 提示 |
|---|---|---|---|
| 1 | 未登录/无效 Token | 401 | Invalid token. |
| 2 | **目标是自己** | 403 | You cannot &lt;action&gt; your own account. |
| 3 | 目标不存在 | 404 | User not found. |
| 4 | **目标等级 ≥ 自己** | 403 | You can only &lt;action&gt; users with lower permissions than your own. |
| 5 | **非 PlatformOwner 且跨餐厅** | 403 | You can only &lt;action&gt; users in your restaurant. |

角色等级（`roleRank`）：PlatformOwner &gt; RestaurantOwner &gt; Admin &gt; Staff &gt; Customer。

| 端点 | 授权策略 |
|---|---|
| `GET /api/admin/users` | PlatformOwnerOnly |
| `GET /api/admin/restaurants/{id}/users` | PlatformOwnerOnly |
| `GET /api/admin/restaurant/users` | AdminApi |
| `PUT /api/admin/users/{id}` | AdminApi + 上表守卫 |
| `DELETE /api/admin/users/{id}` | AdminApi + 上表守卫 |
| `PATCH /api/admin/users/{id}/status` | AdminApi + 上表守卫 |
| `POST /api/admin/users/{id}/unlock` | AdminApi + 上表守卫 |
| `POST /api/admin/users/{id}/send-password-reset` | AdminApi + 上表守卫 |

## 3. 推荐夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| PlatformOwner | 唯一 | 全平台目录、跨餐厅、最高等级边界 |
| RestaurantOwner A/B | 分属餐厅 A/B | 跨租户越权、同级拒绝 |
| Admin A/B | 分属餐厅 A/B | 主要操作者；同级互相拒绝 |
| Staff A/B | 分属餐厅 A/B | 被操作对象与越权尝试者 |
| Customer × 5+ | 无餐厅归属 | audience 筛选、分页、顾客不可越权管理 |
| 一次性账号 × 3 | 每轮新建 | 删除、禁用、改角色的破坏性用例 |
| 已锁定账号 | `accessFailedCount` 达上限、`lockoutEnd` 未来 | Locked 徽章与 Unlock |
| 未验证账号 | `emailConfirmed = false` | Unverified 徽章与 status 筛选 |
| 开启 MFA 账号 | `twoFactorEnabled = true` | MFA 徽章与筛选 |
| 已禁用账号 | `isDisabled = true` | Disabled 徽章与重新启用 |
| 用户数 &gt; 50 | 触发第 2/3 页 | 分页、跨页选择、页码钳制 |
| 测试收件箱 | 可实时查看 | 重置邮件、设置密码邮件、Email test |
| 两个浏览器会话 | 同账号两标签 / A/B 两管理员 | 并发编辑与列表陈旧 |

## 4. 前置检查（6）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-PRE-01 | P1 | 项目目录 | 记录分支、提交、dirty 数量、环境与服务地址 | 明确不是误用生产环境；不覆盖用户改动 | Auto |
| USR-PRE-02 | P1 | 角色账号 | 解析每个夹具的 UserId、roles、restaurantId、等级 | 身份唯一、等级与餐厅归属明确；不记录密码 | Auto |
| USR-PRE-03 | P1 | 数据库 | 导出所有夹具账号的状态字段基线 | 后置可精确核对与恢复 | Auto |
| USR-PRE-04 | P1 | 邮件 | 确认发信通道指向测试收件箱且可读 | 不向真实用户发信 | Auto |
| USR-PRE-05 | P1 | 一次性账号 | 生成本轮删除/禁用用例专用账号并登记 | 破坏性用例不触碰夹具账号 | Auto |
| USR-PRE-06 | P1 | 清理计划 | 定义每个写用例的恢复动作与责任人 | 每次写入都有对应清理 | Auto |

## 5. 路由、角色与越权（16）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-ROLE-01 | P1 | 未登录 | 直接打开、刷新、后退 `/admin/users` | 跳转登录；不闪现任何邮箱、姓名或角色 | Auto |
| USR-ROLE-02 | P1 | Customer | 打开 `/admin/users` | 明确的无权限页面，不是 404，也不是空目录 | Auto |
| USR-ROLE-03 | P1 | Staff A | 打开 `/admin/users` 并直接调用 `GET /api/admin/users` | 页面拒绝；API 403；不返回任何用户记录 | Auto |
| USR-ROLE-04 | P1 | Admin A | 打开目录 | 只看到餐厅 A 的用户；不出现 B 的员工或未归属顾客（除策略允许） | Auto |
| USR-ROLE-05 | P0 | Admin A | 直接调用 `GET /api/admin/users`（PlatformOwnerOnly） | 403；不得因为前端未暴露就返回全平台数据 | Auto |
| USR-ROLE-06 | P0 | Admin A + B 的 userId | 逐个调用 PUT / DELETE / status / unlock / send-password-reset | 全部 403「in your restaurant」；不泄露 B 用户是否存在，且无任何写入 | Auto |
| USR-ROLE-07 | P0 | Admin A + 同级 Admin A2 | 同上五个端点 | 全部 403「lower permissions」；同级不可互相操作 | Auto |
| USR-ROLE-08 | P0 | Admin A + RestaurantOwner A | 同上五个端点 | 全部 403；不可向上操作 | Auto |
| USR-ROLE-09 | P0 | 任意管理员对自己 | 同上五个端点 | 全部 403「your own account」；**尤其确认不能自我禁用或自我删除** | Auto |
| USR-ROLE-10 | P1 | PlatformOwner 对自己 | 禁用/删除自己 | 同样 403；平台不能被锁死 | Auto |
| USR-ROLE-11 | P1 | PlatformOwner | 操作任意餐厅的 Owner/Admin/Staff/Customer | 允许；跨餐厅不受第 5 条守卫限制 | Auto |
| USR-ROLE-12 | P1 | 不存在的 userId | 调用五个端点 | 404「User not found.」；与 403 可区分且不泄露存在性给越权者 | Auto |
| USR-ROLE-13 | P1 | 畸形 userId | 传空串、超长串、`../`、SQL 片段 | 400/404；无异常堆栈、SQL 或内部路径 | Auto |
| USR-ROLE-14 | P1 | 操作过程中被降级 | 管理员打开目录后由他人降级，再执行写操作 | 后端按当前权限拒绝；不依赖前端缓存的旧角色 | Assisted |
| USR-ROLE-15 | P1 | 同浏览器切账号 | Admin A → Admin B 依次登录 | 目录、筛选和选择状态按当前用户重算，不残留上个账号数据 | Auto |
| USR-ROLE-16 | P2 | 直接深链 | 带 `?role=&restaurant=&status=&page=` 深链给低权限用户 | 拒绝发生在数据加载之前；URL 参数不导致越权查询 | Auto |

## 6. 目录加载、搜索、筛选与排序（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-LIST-01 | P1 | 任意管理角色 | 首次打开 Users 分区 | Loading 后显示表格、总数与分页；唯一 H1；无重复标题 | Auto |
| USR-LIST-02 | P1 | 目录接口失败 | 让 `GET users` 返回 500 | 显示可读错误；**不显示 0 条的空目录假象**；可重试 | Auto |
| USR-LIST-03 | P1 | 选项接口失败 | 让餐厅列表失败但用户列表成功 | 用户仍可浏览；餐厅筛选降级并提供重试入口 | Auto |
| USR-LIST-04 | P1 | 搜索 | 依次搜姓名、邮箱片段、大小写混合、前后空格 | 结果与后端一致；trim 后匹配；空格不产生 0 结果 | Auto |
| USR-LIST-05 | P1 | 搜索无结果 | 搜一个确定不存在的串 | 明确空状态文案，不是加载中或错误 | Auto |
| USR-LIST-06 | P2 | 搜索特殊字符 | `%`、`_`、`'`、中文、emoji、200 字符 | 按字面匹配（`%`/`_` 不当通配符）；不报错 | Auto |
| USR-LIST-07 | P1 | 角色筛选 | 逐个选择每个角色 | 结果只含该角色；总数随之变化 | Auto |
| USR-LIST-08 | P1 | 餐厅筛选 | 选择 A、B、All | 结果与餐厅归属一致；Admin 只能选自己餐厅 | Auto |
| USR-LIST-09 | P1 | 状态筛选 all | 默认值 | 含 active/disabled/locked/unverified/mfa 全部 | Auto |
| USR-LIST-10 | P1 | 状态筛选 active | 选择 active | 排除 disabled 与 locked | Auto |
| USR-LIST-11 | P1 | 状态筛选 disabled | 选择 disabled | 只含 `isDisabled` 为真者 | Auto |
| USR-LIST-12 | P1 | 状态筛选 locked | 选择 locked | 只含锁定未过期者；**锁定过期后不应再出现** | Auto |
| USR-LIST-13 | P1 | 状态筛选 unverified | 选择 unverified | 只含 `emailConfirmed = false` | Auto |
| USR-LIST-14 | P1 | 状态筛选 mfa | 选择 mfa | 只含 `twoFactorEnabled = true` | Auto |
| USR-LIST-15 | P1 | 组合筛选 | 搜索 + 角色 + 餐厅 + 状态同时生效 | 后端按交集返回；**分页总数与筛选一致，不能前端二次过滤** | Auto |
| USR-LIST-16 | P1 | 排序 | 对 name / email / restaurant / roles / created 各升降序一次 | 排序在后端进行且跨页一致；方向指示与实际一致 | Auto |
| USR-LIST-17 | P2 | 排序稳定性 | 对同名/同餐厅的多条记录排序 | 相同键值下顺序稳定，翻页不重复或丢记录 | Auto |
| USR-LIST-18 | P1 | 徽章正确性 | 对照数据库核对每种徽章 | Disabled 与 Locked 永不共用一个徽章；Unverified/MFA 独立叠加 | Auto |

## 7. 分页与 URL 状态（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-PAGE-01 | P1 | &gt;50 用户 | 切换 pageSize 10/20/50 | 每页条数正确；`x–y of z` 与实际一致 | Auto |
| USR-PAGE-02 | P1 | 多页 | 前进/后退/首末页 | 无重复或漏项；边界按钮正确禁用 | Auto |
| USR-PAGE-03 | P1 | 深链 | 直接打开带 `page`/`pageSize`/`sort`/`role`/`status` 的 URL | 状态完整还原；刷新后不变 | Auto |
| USR-PAGE-04 | P1 | 页码越界 | 手工把 `page` 改到远超总页数 | **自动钳制到最后一页**并同步 URL；不显示空表 | Auto |
| USR-PAGE-05 | P1 | 筛选后页码 | 在第 3 页施加一个大幅收窄的筛选 | 页码重置到 1；不停留在不存在的页 | Auto |
| USR-PAGE-06 | P2 | 非法参数 | `page=0`、`page=-1`、`page=abc`、`pageSize=999` | 回落到合法默认值，不报错也不请求超大页 | Auto |
| USR-PAGE-07 | P1 | 浏览器后退 | 依次改筛选/排序/页码后连续后退 | 每一步可回退；不出现状态与 URL 不一致 | Auto |
| USR-PAGE-08 | P2 | 分区切换 | Users ↔ Create ↔ Email 来回切换 | 目录筛选状态保留；不重复发起无谓请求 | Auto |
| USR-PAGE-09 | P1 | 数据变更后分页 | 删除当前页最后一条后刷新 | 总数与页数同步；必要时自动回退一页 | Auto |
| USR-PAGE-10 | P2 | 大页容量 | pageSize=50 且总数接近上限 | 响应时间可接受；无明显卡顿或超时 | Assisted |

## 8. 选择与批量操作（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-BULK-01 | P1 | 混合列表 | 检查每行复选框可用性 | **只有可管理的用户可选**；自己、同级、更高级、跨餐厅者不可选 | Auto |
| USR-BULK-02 | P1 | 全选 | 点击表头全选 | 只选中本页可管理者；不含不可管理行 | Auto |
| USR-BULK-03 | P1 | 半选状态 | 手动选中部分行 | 全选框呈 indeterminate；再点一次行为明确（全选或全不选） | Auto |
| USR-BULK-04 | P1 | 跨页选择 | 选中后翻页 | 选择状态的行为与文案一致（保留或清空），不出现"看起来选了但没生效" | Auto |
| USR-BULK-05 | P1 | 筛选后选择 | 选中后改变筛选 | 选择被清空或明确保留；不会对不在结果里的用户执行操作 | Auto |
| USR-BULK-06 | P1 | 批量启用 | 选中若干禁用账号执行 Enable | 全部启用；结果计数与实际一致；列表刷新 | Auto |
| USR-BULK-07 | P0 | 批量禁用 | 选中若干账号执行 Disable | **弹出确认对话框**；确认后全部禁用；取消则一个都不改 | Auto |
| USR-BULK-08 | P1 | 批量改角色 | 选择目标角色执行 | 只改到低于自己等级的角色；越权目标被拒绝且被明确报告 | Auto |
| USR-BULK-09 | P0 | 部分失败 | 构造其中一个目标会 403（如中途被他人提权） | **逐条报告成功/失败数量**；成功的不回滚、失败的不假装成功 | Auto |
| USR-BULK-10 | P1 | 全部失败 | 让所有目标都被拒 | 明确失败提示；列表状态不变 | Auto |
| USR-BULK-11 | P1 | 空选择 | 不选任何行点击批量操作 | 操作不可用或安全忽略；不发请求 | Auto |
| USR-BULK-12 | P1 | 执行中防重入 | 批量执行中连续点击 | 按钮禁用且不发起第二批；无重复写入 | Auto |
| USR-BULK-13 | P1 | 批量后清理 | 执行完成 | 选择被清空；总数/分页刷新；审计逐条记录 | Auto |
| USR-BULK-14 | P2 | 大批量 | 一次选中 50 条执行 | 全部完成或明确部分失败；无超时假成功 | Assisted |

## 9. 行内编辑：姓名、邮箱、角色、餐厅、密码（16）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-EDIT-01 | P1 | 可管理用户 | 打开编辑 | 表单预填当前值；取消不产生任何写入 | Auto |
| USR-EDIT-02 | P1 | 姓名 | 改为正常姓名并保存 | 保存成功；列表与数据库一致 | Auto |
| USR-EDIT-03 | P1 | 姓名留空 | 清空姓名保存 | 按"留空即不修改"语义处理，不得把姓名清成空字符串 | Auto |
| USR-EDIT-04 | P1 | 姓名纯空白 | 输入三个空格保存 | **拒绝或按不修改处理，绝不写入空白姓名** | Auto |
| USR-EDIT-05 | P1 | 姓名超长 | 输入 101 与 257 字符 | 超过 100 被拒且提示明确；长度在 trim 之后判定 | Auto |
| USR-EDIT-06 | P1 | 姓名前后空格 | `  Ada Lovelace  ` | 存储值已 trim | Auto |
| USR-EDIT-07 | P1 | 邮箱 | 改为未被占用的合法邮箱 | 成功；**用户名同步变更**，两者不得出现不一致 | Auto |
| USR-EDIT-08 | P1 | 邮箱已占用 | 改为另一账号的邮箱 | 明确拒绝；不产生半改状态 | Auto |
| USR-EDIT-09 | P1 | 邮箱非法 | `a@`、`a b@c.com`、超长本地部 | 拒绝并提示；不写库 | Auto |
| USR-EDIT-10 | P1 | 角色变更 | 改为低于自己等级的角色 | 成功；目标的可访问范围随之变化（重新登录后核对） | Auto |
| USR-EDIT-11 | P0 | 角色提权 | 试图改成与自己同级或更高 | 拒绝；**不得通过直接调 API 绕过前端下拉的限制** | Auto |
| USR-EDIT-12 | P0 | 餐厅归属 | Admin A 把用户改到餐厅 B | 拒绝；PlatformOwner 允许 | Auto |
| USR-EDIT-13 | P1 | 管理员改密码 | 通过编辑设置新密码 | 遵守与注册相同的强度规则（≥8、大小写、数字、符号） | Auto |
| USR-EDIT-14 | P1 | 密码超长 | 设置 129 与 4096 字符密码 | **拒绝而不是截断**；提示上限 128 | Auto |
| USR-EDIT-15 | P1 | 目标会话 | 改密码/改邮箱后检查目标已有会话 | 按策略失效或明确说明；不出现"改了但旧会话仍可用"而无记录 | Assisted |
| USR-EDIT-16 | P1 | 审计 | 对每类修改核对审计 | 记录操作者、目标、餐厅与前后值；**不记录密码明文** | Auto |

## 10. 启用、禁用、解锁与重置密码（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-STATE-01 | P0 | 启用中的账号 | 禁用 | 徽章变 Disabled；**该用户随后无法登录**（实测一次） | Auto |
| USR-STATE-02 | P1 | 已禁用账号 | 启用 | 恢复登录能力；徽章回到 Active | Auto |
| USR-STATE-03 | P1 | 已禁用账号 | 检查其既有会话/Refresh Token | 按策略失效；不得禁用后仍能靠旧 Token 继续操作 | Auto |
| USR-STATE-04 | P1 | 锁定账号 | 点击 Unlock | 锁定解除、失败计数归零；用户可立即重试登录 | Auto |
| USR-STATE-05 | P1 | 未锁定账号 | 对其调用 unlock | 幂等成功或明确无操作；不产生误导性成功提示 | Auto |
| USR-STATE-06 | P1 | 锁定已自然过期 | 打开目录 | 不再显示 Locked；与 status=locked 筛选一致 | Auto |
| USR-STATE-07 | P1 | 可管理用户 | Send password reset | 提示成功；**测试收件箱确实收到** | Assisted |
| USR-STATE-08 | P1 | 重置邮件内容 | 检查收到的邮件 | 使用统一版式：有发件方名称、ABN、支持邮箱；说明是管理员代发；链接一小时过期 | Assisted |
| USR-STATE-09 | P1 | 重置链接 | 在测试收件箱点击链接完成改密 | 可成功改密；改密后旧密码失效 | Assisted |
| USR-STATE-10 | P1 | 无邮箱账号 | 对没有邮箱的账号发重置 | 明确拒绝，不假装已发送 | Auto |
| USR-STATE-11 | P2 | 发信失败 | 让邮件通道失败 | 明确失败提示；不谎报成功；不因此改动账号状态 | Auto |
| USR-STATE-12 | P1 | 审计 | 核对禁用/启用/解锁/发重置的审计 | 四类都有记录，含操作者与目标；失败尝试不产生成功记录 | Auto |

## 11. 删除用户（8）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-DEL-01 | P1 | 一次性账号 | 打开删除对话框 | 必须输入指定确认串才能提交；**默认按钮不可点** | Auto |
| USR-DEL-02 | P1 | 确认串错误 | 输入错误/大小写不符/带空格 | 提交保持禁用 | Auto |
| USR-DEL-03 | P1 | 取消 | 输入正确后取消 | 无任何删除；重开对话框时输入已清空 | Auto |
| USR-DEL-04 | P0 | 一次性账号 | 确认删除 | 账号消失；列表与总数刷新；数据库中确实不可再登录 | Auto |
| USR-DEL-05 | P0 | 有历史数据的账号 | 删除下过单的测试顾客 | 订单/支付历史按策略保留或匿名化；**不得产生悬空引用或让订单查询报错** | Auto |
| USR-DEL-06 | P0 | 越权 | 对自己、同级、更高级、跨餐厅者删除 | 全部 403；错误信息与第 2 节一致 | Auto |
| USR-DEL-07 | P1 | 重复删除 | 对已删除的 userId 再次调用 | 404；不产生第二条审计成功记录 | Auto |
| USR-DEL-08 | P1 | 审计 | 核对删除审计 | 记录操作者、目标邮箱与餐厅；删除后仍可追溯 | Auto |

## 12. 创建用户（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-NEW-01 | P1 | Create 分区 | 打开表单 | 角色下拉**只列出低于自己等级的角色**；Admin 看不到 Owner/PlatformOwner | Auto |
| USR-NEW-02 | P1 | 必填校验 | 全部留空提交 | 姓名、邮箱、角色各自给出提示；不发请求 | Auto |
| USR-NEW-03 | P1 | 姓名纯空白 | 输入三个空格提交 | 拒绝「Full name is required.」；**不得建号也不得发确认邮件** | Auto |
| USR-NEW-04 | P1 | 姓名超长 | 101 字符 | 拒绝并提示上限 100 | Auto |
| USR-NEW-05 | P1 | 邮箱重复 | 用已存在邮箱 | 明确拒绝；不建号 | Auto |
| USR-NEW-06 | P1 | 邮箱格式 | 多种非法格式 | 拒绝；提示可读 | Auto |
| USR-NEW-07 | P1 | 临时密码 | 关闭"发送设置邮件"并填写密码 | 密码遵守强度规则；界面实时显示还缺哪一项 | Auto |
| USR-NEW-08 | P1 | 密码上限 | 129 与 4096 字符 | 拒绝而非截断 | Auto |
| USR-NEW-09 | P1 | 设置密码邮件 | 开启"发送设置邮件"提交 | 不要求填密码；测试收件箱收到设置邮件；账号在设置前不可用密码登录 | Assisted |
| USR-NEW-10 | P0 | 角色越权 | 直接调 API 创建与自己同级/更高角色 | 拒绝；前端下拉的限制不是唯一防线 | Auto |
| USR-NEW-11 | P0 | 餐厅越权 | Admin A 创建归属餐厅 B 的用户 | 拒绝；PlatformOwner 允许并需显式选择餐厅 | Auto |
| USR-NEW-12 | P1 | 创建后可用性 | 用新账号按其角色登录 | 权限范围与所选角色/餐厅一致，不多不少 | Assisted |
| USR-NEW-13 | P1 | 创建后目录 | 返回 Users 分区 | 新用户出现在目录且徽章正确（未验证/无 MFA） | Auto |
| USR-NEW-14 | P1 | 防重入 | 连续快速提交两次 | 只创建一个账号；不产生重复邮箱冲突脏数据 | Auto |

## 13. Email test 分区（6）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-MAIL-01 | P1 | PlatformOwner | 打开 Email test 分区 | 仅平台级角色可见/可用；低权限角色不可调用该端点 | Auto |
| USR-MAIL-02 | P1 | 正常发送 | 填测试收件箱并发送 | 提示成功；收件箱确实收到 | Assisted |
| USR-MAIL-03 | P1 | 邮件外观 | 检查收到的测试邮件 | **与真实事务邮件同一版式**（有发件方身份与页脚），而不是裸段落 | Assisted |
| USR-MAIL-04 | P1 | 收件人非法 | 空值与非法格式 | 拒绝并提示；不发信 | Auto |
| USR-MAIL-05 | P1 | 通道故障 | 关闭/改错发信配置 | 明确失败提示；**不显示 API Key、堆栈或内部地址** | Auto |
| USR-MAIL-06 | P2 | 内容注入 | 主题/正文含 `<script>` 与超长文本 | 转义后送达；不破坏邮件结构 | Auto |

## 14. 并发、恢复、无障碍与响应式（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| USR-REC-01 | P1 | 两名管理员 | 同时编辑同一用户并先后保存 | 结果可解释：要么后写覆盖并可见，要么冲突提示；**不得静默丢失一方的全部修改** | Assisted |
| USR-REC-02 | P1 | 列表陈旧 | A 删除某用户后 B 在旧列表上操作它 | 404 且提示可读；列表能刷新到正确状态 | Assisted |
| USR-REC-03 | P1 | 请求中断 | 保存/删除/批量执行时刷新或断网 | 以服务器为准；无假成功、无重复写入、无永久 busy | Auto |
| USR-REC-04 | P1 | API 401/403/429/500 | 覆盖各操作的错误呈现 | 短消息可重试；不显示 SQL、堆栈、内部地址或 Token | Auto |
| USR-REC-05 | P1 | 会话过期 | 停留后执行写操作 | 引导重新登录；不丢弃已填表单内容或明确告知 | Assisted |
| USR-REC-06 | P1 | 页面语义 | 检查 H1、表格、分区 Tabs、Dialog | 唯一 H1；表格有表头关联；Tabs 有名称与选中状态 | Auto/Assisted |
| USR-REC-07 | P1 | 控件命名 | 检查每个图标按钮 | 禁用/启用/解锁/删除/编辑都有可读名称，**不只靠图标或颜色区分** | Auto |
| USR-REC-08 | P1 | 纯键盘 | 完成搜索→筛选→选择→批量→编辑→保存全流程 | 焦点顺序合理可见、无陷阱；Dialog 关闭后焦点回到触发器 | Assisted |
| USR-REC-09 | P2 | 屏幕阅读器 | 读取行状态、批量条、确认对话框 | 徽章语义可读；批量结果通过合适 live region 宣告 | Assisted |
| USR-REC-10 | P1 | 390/430px 手机 | 浏览目录、批量条、编辑与删除对话框 | 无横向溢出；操作按钮不被遮挡；确认输入可见 | Assisted |
| USR-REC-11 | P1 | 平板/200% zoom | 重复关键操作 | 表格降级方案可用；Dialog 可滚动可关闭 | Assisted |
| USR-REC-12 | P1 | 前端自动化 | 运行 admin users 相关单测 | 正常、失败、权限、越权与批量部分失败均有断言 | Auto |
| USR-REC-13 | P1 | 后端自动化 | 运行 users 权限与租户测试 | 五条守卫、角色等级与跨餐厅拒绝均覆盖且无关键 skip | Auto |
| USR-REC-14 | P1 | 测试结束 | 核对数据库与收件箱并审查证据 | 所有夹具账号状态恢复；一次性账号已清理；截图无密码/Token/真实顾客邮箱 | Auto |

## 15. 推荐执行顺序

1. `USR-PRE-*`，确认身份、基线与收件箱。
2. `USR-ROLE-*`，先把越权边界钉死——**后面所有写用例都建立在这层结论之上**。
3. 只读的 `USR-LIST-*`、`USR-PAGE-*`。
4. `USR-BULK-*` 的选择与禁用逻辑，使用一次性账号。
5. `USR-EDIT-*`、`USR-STATE-*`，每个子组结束立即恢复。
6. `USR-NEW-*`、`USR-MAIL-*`（会真实发信，集中执行便于核对收件箱）。
7. `USR-DEL-*`，只对本轮一次性账号。
8. 并发、故障、无障碍、响应式与最终清理。

## 16. 用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| 收件箱 | 打开测试收件箱并转述收到的邮件标题与正文要点 | 核对版式、发件方身份、过期时间与链接指向测试环境 |
| 重置链接 | 在测试收件箱点击重置链接并设置新密码 | 核对新密码可登录、旧密码失效、审计记录正确 |
| 禁用生效 | 用被禁用账号尝试登录一次 | 确认确实被拒且提示不泄露账号是否存在 |
| 触屏 | 在手机上完成选择与批量禁用 | 复选框可点、确认对话框不被遮挡 |
| 屏幕阅读器 | 用 VoiceOver 读一行用户记录 | 徽章与操作按钮的可读名称正确成组 |

## 17. 完成标准

- 所有被选 `USR-*` 都记录为 PASS/FAIL/BLOCKED/NOT RUN；部分观察不能冒充 PASS。
- **P0 任一失败即阻止上线结论**：跨餐厅越权、同级/向上越权、自我禁用或自我删除、角色提权绕过、批量部分失败被谎报为成功、删除导致数据悬空。
- 每个写操作在数据库、目录 UI 与审计三处一致，并完成恢复。
- 所有发出的邮件都落在测试收件箱，且版式与身份信息正确。
- 测试报告不含密码、临时密码、完整重置 Token、Cookie、Access/Refresh Token 或真实顾客邮箱全文。
- 本包通过不代表登录/注册、个人资料安全、Dashboard、订单或支付验收通过。
