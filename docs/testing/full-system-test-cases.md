# DineFlow 全功能测试用例

用途：发布前回归、首店试运营验收、问题修复后的逐项复测。  
状态值：`PASS`、`FAIL`、`BLOCKED`、`NOT RUN`。  
任何会真实扣款、退款、发邮件、打印或删除数据的步骤，只能在明确的测试环境与测试账号中执行。

本文件也是 `$dineflow-system-test` 的项目扩展目录。以后新增项目专用功能测试时追加到这里；与 Skill 内置用例 ID 相同的项目用例优先。普通代码修改不会自动触发这些测试，只有用户明确要求某个测试包、用例或全量测试时才执行。

每次新运行从 [full-system-test-template.md](full-system-test-template.md) 建立独立记录。2026-08-09 的历史结果保留在 [full-system-release-test-2026-08-09.md](full-system-release-test-2026-08-09.md)，不要用旧结果代替复测。

普通注册、密码登录、Google 首次注册/登录和 Magic Link 的详细正常、非法、边界、Cancel 与 Submit 用例位于 [login-registration-test-cases.md](login-registration-test-cases.md)。Profile、头像、邮箱、密码、MFA 和 Passkey 的专项矩阵位于 [profile-security-test-cases.md](profile-security-test-cases.md)。Dashboard 的角色、指标、订单、公开 URL、营业配置、Watched items 与布局专项矩阵位于 [dashboard-test-cases.md](dashboard-test-cases.md)。Admin Menu 的选店、分类、菜品、库存、食品信息、选项和图片专项矩阵位于 [admin-menu-test-cases.md](admin-menu-test-cases.md)。完整线上支付链路、Stripe 官方测试卡、decline、3DS、Webhook、并发、退款与争议位于 [payment-system-test-cases.md](payment-system-test-cases.md)。Admin Payments 的三标签、Stripe 同步、手续费/净额、收据、争议、直接退款、退款审批与导出矩阵位于 [admin-payments-test-cases.md](admin-payments-test-cases.md)。Admin Reports 的业务可读性、技术证据、权限、筛选、时间/币种、CSV、保留与无障碍矩阵位于 [admin-reports-test-cases.md](admin-reports-test-cases.md)。购物车的商品、共享桌台、Session/Token、临近过期、库存、结账幂等和四个订单页面交接矩阵位于 [cart-test-cases.md](cart-test-cases.md)。Staff Orders 的岗位队列、Kitchen 看板、支付阻断、SLA、实时更新、音效、打印站与恢复矩阵位于 [staff-orders-test-cases.md](staff-orders-test-cases.md)。Front Counter 的取餐、柜台收款、找零、桌台 Session、整桌结算、冲正与收据矩阵位于 [front-counter-test-cases.md](front-counter-test-cases.md)。通知、完整营业链路、运营发布分别位于本文 L、M、N 节；手机、平板、辅助技术、桌面浏览器和实体打印机矩阵位于 [real-device-test-cases.md](real-device-test-cases.md)。它们分别作为独立测试包与 `full` 相连，但默认不执行。

## 测试数据与账号

不要在本文保存生产密码。测试账号密码从本地安全配置或密码管理器读取。推荐至少准备：

- 1 个 Platform Owner。
- 2 个不同餐厅的 Restaurant Owner。
- 每店 1 个 Admin、1 个 Staff。
- 1 个已确认 Customer、1 个未确认 Customer。
- 1 个未登录 Guest 浏览器会话。
- 1 个已连接 Stripe Sandbox 的 AU 餐厅、1 个未连接 Stripe 的餐厅。
- 1 台 QZ Tray + 热敏打印机测试终端。
- 2 个同餐厅 Staff 会话、2 个跨餐厅 Staff 会话和至少 1 个 Customer/Guest 辅助会话。
- 1 个可控测试邮箱、可控 SignalR 断连方式和可重放的测试事件源。
- 1 个 disposable PostgreSQL/备份恢复目标、至少 2 个 API 实例和测试告警接收渠道。
- 1 台真实 iPhone Safari、1 台 Android Chrome、1 台平板及键盘/屏幕阅读器环境。

## A. 构建、测试与静态检查

| ID | 操作 | 预期 | 2026-08-09 |
|---|---|---|---|
| A01 | 使用项目固定 Node 版本执行 `npm ci` 和生产构建 | 构建成功，无缺失环境变量导致的空页面 | PASS |
| A02 | 执行前端测试 | 所有测试通过，命令本身不依赖本机 Node 实验特性 | FAIL：需额外关闭 experimental webstorage |
| A03 | 执行前端 lint | 0 errors；警告有明确豁免 | FAIL：77 errors、9 warnings |
| A04 | 使用 .NET 8 执行后端测试 | 全部通过，无关键跳过 | FAIL：237 通过、4 跳过 |
| A05 | 执行 `npm audit --omit=dev` | 无未接受的 high/critical 漏洞 | FAIL：8 high |
| A06 | 执行 `dotnet list package --vulnerable --include-transitive` | 无 high/critical 漏洞 | FAIL：2 high |
| A07 | 检查 CI workflow | PR 必须运行 build、test、lint、依赖审计 | FAIL：当前只 build |

## B. 认证与账号生命周期

| ID | 账号/条件 | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|---|
| B01 | 任意账号 | 正确邮箱密码登录 | 进入对应默认页面，无敏感 toast | PASS |
| B02 | 任意账号 | 输入错误密码一次 | 只显示通用短错误，不暴露账号是否存在或堆栈 | PASS |
| B03 | 测试账号 | 连续输入错误密码达到阈值 | 账号暂时锁定，返回通用提示，日志与告警可查 | FAIL：未启用锁定 |
| B04 | 单一 IP/邮箱 | 快速重复调用 login | 达到阈值返回 429，正常用户不受长期影响 | FAIL：无 login 专用限流 |
| B05 | 新 Customer | 输入 6 位复杂密码并同意条款 | 应拒绝低于正式最短长度的密码 | FAIL：6 位被接受 |
| B06 | 新 Customer | 不勾选条款 | Create 与社交注册不可提交，仅显示就地说明 | PASS |
| B07 | 新 Customer | 勾选条款后创建 | 记录条款/隐私版本、时间、主体、来源 | PASS（代码/单测）；需 DB 抽查 |
| B08 | Google/Facebook | 未勾选首次注册同意后点击 | 按钮不可用并有就地说明，不弹重复 toast | PASS（UI） |
| B09 | Google/Facebook | 已有账号登录 | 不应被“首次注册”同意错误阻挡 | NOT RUN |
| B10 | Magic Link | 请求链接、打开链接、账号要求 MFA | 完成 Magic Link 后仍进入 MFA challenge | NOT RUN：需真实邮箱 |
| B11 | Passkey | 已有账号注册 passkey | 记录凭据名称和时间，敏感操作要求 MFA/再认证 | NOT RUN：需设备 |
| B12 | Passkey | 新用户直接尝试 passkey 登录 | 不应在未建立账户/未同意条款时静默注册 | NOT RUN |
| B13 | MFA | 两个请求同时首次更新 MFA 设置 | 只生成一条设置记录，无 PK 冲突 | BLOCKED：PostgreSQL 并发测试跳过 |
| B14 | 登录页 | 打开生产构建 | 邮箱/密码为空，不显示演示凭据 | FAIL：硬编码演示值 |
| B15 | 登出/刷新 | 登录后登出，再使用旧 refresh token | 旧 token 被撤销，受保护页面不可访问 | NOT RUN |

## C. 权限与租户隔离

| ID | 账号 | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|---|
| C01 | Platform Owner | 打开所有 `/admin/*` 页面 | 可访问平台范围数据 | PASS |
| C02 | Restaurant Owner A | 打开 Users、Restaurants、Reports | 只看到餐厅 A | PASS |
| C03 | Admin A | 打开 Dashboard、Users、Payments | 只看到餐厅 A | PASS |
| C04 | Staff A | 打开 Staff orders、Front counter、Admin orders | 可执行岗位授权功能 | PASS |
| C05 | Staff A | 直接访问 Users、Payments、Restaurants URL | 被阻止且无数据闪现 | PASS；仅静默重定向 |
| C06 | Customer | 直接访问 `/admin` 与 `/staff/orders` | 被阻止且无数据闪现 | PASS |
| C07 | Owner/Admin A | 手工替换 API restaurantId 为餐厅 B | API 返回 403/404，不泄漏餐厅 B 存在性 | NOT RUN：需 API 负向测试 |
| C08 | 已登出用户 | 浏览器后退到受保护页 | 不显示缓存中的个人/订单数据 | NOT RUN |

## D. 餐厅资料、Stripe 导入与法律身份

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| D01 | 打开 View restaurant 弹窗并滚动到底 | 内容不溢出，底部资料可访问 | PASS |
| D02 | 打开 Edit restaurant | 弹窗可滚动，Save 固定可见，Import 不被压缩 | PASS |
| D03 | 点击 Import from Stripe | 后端只返回建议，不立即保存；显示当前值/Stripe 值 | PASS |
| D04 | 当前字段非空 | 默认不勾选覆盖；用户可单独选择 | PASS |
| D05 | 当前字段为空 | 默认选择 Stripe 可用值 | NOT RUN：当前资料均非空 |
| D06 | 查看 ABN/GST/收费/退款政策 | 保持人工确认，Stripe 不自动覆盖 | PASS |
| D07 | 输入 11 位但 checksum 无效的 ABN | 前后端拒绝并解释格式 | FAIL：只检查 11 位数字 |
| D08 | 生产环境缺法律主体变量 | 后端拒绝启动；前端构建也应拒绝或明确告警 | 部分 PASS：后端拒绝，CD 未注入前端变量 |

## E. 菜单、食品与过敏原

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| E01 | Guest 打开公开菜单 | 名称、价格、币种、状态与餐厅一致 | PASS |
| E02 | 搜索不存在内容并清空筛选 | 显示空状态，清除后恢复菜单 | PASS |
| E03 | 打开 sold-out 菜品 | 不可加入购物车，状态清楚 | PASS |
| E04 | 打开 Market Arancini | 图片、名称、描述、饮食标签一致 | FAIL：显示 Chicken Wings 图片 |
| E05 | 编辑包含法定过敏原的菜品 | 使用 FSANZ plain-English 名称，公开页可见 | FAIL：当前字段为空 |
| E06 | 设置 may contain/cross-contact | 公开详情和结账前可方便查看 | NOT RUN：当前数据为空 |
| E07 | 输入 Allergy notes | 显示健康信息用途、访问者和保留说明，并最小化收集 | FAIL：缺少单独提示/同意 |
| E08 | 选项改变价格 | 商品行、购物车、小计、Stripe 金额一致 | PASS（基础组合）；需更多组合回归 |

## F. 购物车、订单与柜台付款

| ID | 条件 | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|---|
| F01 | Guest Takeaway | 加商品、改数量、进入结账 | 总额正确，创建订单一次 | PASS |
| F02 | Guest Dine-in | 从桌码/餐厅入口结账 | 显示堂食信息和餐后柜台付款文案 | PASS |
| F03 | Takeaway 柜台付 | 点击柜台支付确认 | 显示取餐时付款，不重复创建订单 | PASS |
| F04 | Dine-in 柜台付 | 点击柜台支付确认 | 显示餐后付款，不与“尚未下单”文案矛盾 | PASS（按钮文案） |
| F05 | 重复点击提交 | 快速双击/刷新 | 只产生一个订单或使用幂等键恢复 | NOT RUN |
| F06 | 库存最后一份 | 两个 Guest 同时下单 | 只有一个成功，库存不为负 | NOT RUN |

## G. Stripe 与退款

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| G01 | 使用 Stripe Sandbox 标准成功卡付款 | Stripe 成功，顾客页明确成功，管理端 Paid | FAIL：管理端 Paid，顾客页卡确认中 |
| G02 | 在 Stripe 页取消 | 返回 cancelled 页面，明确未扣款，可重试 | PASS |
| G03 | 使用 declined 测试卡 | 显示简短拒付提示，订单仍可安全重试 | BLOCKED：Stripe Link 测试页持续 Processing |
| G04 | 使用 3DS 测试卡 | challenge 成功/失败/关闭三种结果正确 | NOT RUN |
| G05 | 延迟 webhook | 顾客页轮询/恢复，最终一致且不过早宣告失败 | NOT RUN |
| G06 | 重放同一 webhook 2 次 | 只记录一次支付事件，不重复通知/打印 | NOT RUN |
| G07 | 整单退款 | Stripe 与 DineFlow 金额、状态、审计一致 | NOT RUN |
| G08 | 按商品部分退款 | 分配金额不超过各商品可退余额 | UI PASS；未提交 |
| G09 | 两个管理员同时退款/void | 只成功一次，余额不为负 | BLOCKED：3 个并发测试跳过 |
| G10 | Customer 提交退款请求 | 管理端可审查、批准/拒绝并留下理由 | NOT RUN |

## H. 打印与运营

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| H01 | 打开打印设置 | QZ Tray、路由、纸宽、打印机可配置 | PASS |
| H02 | 点击 Test connection | 状态在合理时间变为 Passed/Failed | PASS：Passed |
| H03 | 打印测试票 | 厨房票格式、中文/英文、切纸、金额正确 | NOT RUN：避免实体打印 |
| H04 | 断开打印机后下单 | 任务进入失败/重试，不丢单不重复 | NOT RUN |
| H05 | 恢复打印机 | 只补打应该补打的任务 | NOT RUN |
| H06 | Mac 睡眠/重启、缺纸恢复 | 队列、证书信任和自动打印恢复 | NOT RUN |
| H07 | 连续 30–50 单 | 无漏打、重打、乱序，声音/通知可控 | NOT RUN |

## I. 隐私、数据与可访问性

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| I01 | 从所有顾客关键页打开 Terms/Privacy/Refunds/Allergen | 无 404，内容与版本一致 | PASS（桌面） |
| I02 | Customer 提交 access/correction/deletion/complaint | 可追踪状态，后台能分派和回复 | 部分实现；完整 UI NOT RUN |
| I03 | 到达保留期 | 定时删除或不可逆去标识化，法律保留可审计 | FAIL：仅有政策，无执行任务 |
| I04 | 导出报表 | 行数限制、截断说明、权限与审计正确 | UI PASS；导出文件未检查 |
| I05 | 键盘完成登录、菜单、结账 | 焦点可见，顺序合理，无键盘陷阱 | NOT RUN |
| I06 | 屏幕阅读器检查标题、表格、对话框 | 页面有唯一 H1，控件有名称 | 部分 PASS；Dashboard 未发现 H1 |
| I07 | 手机 Safari/Chrome | 无横向溢出，弹窗、底部按钮和输入可用 | NOT RUN：需真机/移动视口 |

## J. 部署、恢复与监控

| ID | 操作步骤 | 预期 | 2026-08-09 |
|---|---|---|---|
| J01 | 以 Production 启动 API | 不写 Demo 数据，不重置任何密码 | FAIL：无条件 Seeder |
| J02 | 生产发布数据库迁移 | 独立一次性 migration task，应用副本不并发迁移 | FAIL：应用启动自动迁移 |
| J03 | 部署 S3/CloudFront + ECS | API、auth、SignalR/WebSocket 路由一致 | FAIL：CD API base 为空，auth 仍相对 `/api` |
| J04 | 生产缺法律/服务邮箱 | 发布流水线失败并指出缺失项 | FAIL：前端 CD 未校验/注入 |
| J05 | 触发 API/DB/webhook 故障 | ECS/RDS/Stripe 告警到达值班渠道 | NOT RUN |
| J06 | 执行 RDS 备份恢复 | 新环境能恢复、校验订单/支付/审计完整 | NOT RUN |

## K. 新增部分功能测试包

这些用例可单独请求，不需要运行整套 full-system。

`login-registration` 的完整矩阵不在本节重复，见 [login-registration-test-cases.md](login-registration-test-cases.md)。

| ID | 测试包 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| K01 | email-auth | 新测试邮箱 | 注册、收确认邮件、首次打开链接、再次打开 | 首次确认成功；重复链接安全失败；不暴露账号信息 | 用户协助 |
| K02 | email-auth | 已确认账号和测试邮箱 | 请求 Magic Link，完成链接后触发 MFA | Magic Link 不绕过 MFA；链接只能使用一次 | 用户协助 |
| K03 | email-auth | 测试邮箱 | 连续请求确认、Magic Link、重置密码 | IP 与收件人均有限流；正常邮件不重复轰炸 | 自动/用户协助 |
| K04 | mfa-passkey | Touch ID/Windows Hello 设备 | 注册首个 Passkey，登出，再使用 Passkey 登录 | 必须有用户手势；登录到正确账号；审计可查 | 用户协助 |
| K05 | mfa-passkey | 两台设备或两个凭据 | 注册两个 Passkey，删除其中一个再分别登录 | 删除的失败；保留的继续工作 | 用户协助 |
| K06 | user-management | Platform Owner | 创建每种角色，尝试缺失/错误餐厅分配 | 合法组合成功；非法组合被前后端拒绝 | 自动 |
| K07 | realtime-orders | 两个 Staff 会话 | 同时打开订单，A 改状态，B 观察并继续操作 | 实时更新；旧状态提交产生冲突而非覆盖 | 自动 |
| K08 | notifications | 可控 Stripe/打印测试环境 | 触发断连、恢复、支付异常和订单提醒 | 正确受众、去重、恢复后清除 | 自动/用户协助 |
| K09 | receipts | 测试订单和打印/下载权限 | 对比顾客收据、柜台收据、后台订单 | 金额、币种、ABN、付款类型、退款联系方式一致 | 用户协助 |
| K10 | accessibility | 键盘和屏幕阅读器 | 完成登录、菜单、购物车、结账 | 焦点可见、顺序合理、唯一 H1、无键盘陷阱 | 用户协助 |
| K11 | responsive | 手机 Safari/Chrome、平板 | 完成公开菜单、购物车、登录、编辑弹窗 | 无横向溢出；底部按钮和输入不被遮挡 | 用户协助 |
| K12 | recovery | 两个浏览器标签 | 同一订单同时开启支付并刷新/返回 | 不重复扣款；只保留可恢复的有效支付尝试 | 自动 |
| K13 | profile-security | Customer、非 Customer、测试邮箱、TOTP/Passkey 设备、PostgreSQL | 执行 [Profile 与账号安全专项](profile-security-test-cases.md) 中被明确选择的 `PROF-*` 用例 | Profile 数据正确；MFA 与敏感操作不可绕过；会话和审计一致 | 自动/用户协助 |
| K14 | dashboard | PlatformOwner、Owner/Admin/Staff A/B、测试订单/桌台/菜品/营业日历、两标签/移动设备 | 执行 [Dashboard 专项](dashboard-test-cases.md) 中被明确选择的 `DASH-*` 用例 | 指标与权限范围一致；快捷写操作可恢复；布局隔离；无租户/桌码泄露 | 自动/用户协助 |
| K15 | admin-menu | PlatformOwner、Owner/Admin/Staff A/B、一次性分类/菜品/选项、食品信息矩阵、测试图片和顾客端 | 执行 [Admin Menu 专项](admin-menu-test-cases.md) 中被明确选择的 `MENU-*` 用例 | 租户与权限隔离；价格/库存/食品信息/选项一致；所有写入可恢复且无图片残留 | 自动/用户协助 |
| K16 | admin-payments | PlatformOwner、Owner/Admin/Staff A/B、两家 Stripe Sandbox connected account、支付/退款/请求/争议矩阵、Webhook 控制与专用邮箱 | 执行 [Admin Payments 专项](admin-payments-test-cases.md) 中被明确选择的 `PAY-*` 用例 | 三标签与租户范围一致；金额/币种/手续费/净额正确；Checkout、同步、退款、审批与 webhook 幂等；无重复或超额资金动作 | 自动/用户协助 |
| K17 | admin-reports | PlatformOwner、Owner/Admin A/B、Staff/Customer/Guest、A/B 时区与多币种日志、CSV 下载、移动 viewport/zoom/theme | 执行 [Admin Reports 专项](admin-reports-test-cases.md) 中被明确选择的 `RPT-*` 用例 | 业务活动一眼可读；技术证据完整且最小披露；金额/时区/租户/CSV/保留准确；小屏与 200% 缩放可用 | 自动/用户协助 |
| K18 | cart | Guest A/B、Customer A/B、同店/跨店 Staff、桌码、菜单/库存/选项矩阵、双标签、可控时钟/DB、移动设备 | 执行 [购物车专项](cart-test-cases.md) 中被明确选择的 `CART-*` 用例 | Cart/Token/登录 Session 分层正确；临近过期与真正过期可恢复；价格库存重校验；Checkout 幂等；My/Staff/Front/Admin Orders 不重不漏 | 自动/用户协助 |
| K19 | staff-orders | Staff A/B、同店双会话、状态/支付/SLA/备注/退款行矩阵、QZ 测试终端、打印站租约、移动设备 | 执行 [Staff Orders 专项](staff-orders-test-cases.md) 中被明确选择的 `STAFF-*` 用例 | 岗位与租户隔离；Orders/Kitchen 分类一致；支付阻断不可绕过；轮询/实时并发收敛；打印不漏不重且无空签名授权弹窗 | 自动/用户协助 |
| K20 | front-counter | Staff A/B、同店双会话、Takeaway/DineIn/桌台 Session、Tender/支付/冲正矩阵、QZ 前台打印机、移动设备 | 执行 [Front Counter 专项](front-counter-test-cases.md) 中被明确选择的 `FC-*` 用例 | 岗位与租户隔离；未 Ready/支付阻断不可完成；收款找零与整桌结算原子且幂等；冲正和收据一致 | 自动/用户协助 |
| K21 | payment-system | Customer/Guest、Owner/Admin/Staff A/B、两家独立 Stripe Sandbox connected account、官方成功/失败/3DS/Radar/争议/异步退款测试方式、Webhook/故障控制、移动设备 | 执行 [Payment System 专项](payment-system-test-cases.md) 中被明确选择的 `PS-*` 用例 | direct charge 归属、金额/币种/平台费正确；decline/3DS/取消不误履约；回跳、Webhook、对账、并发和退款最终一致且不重不漏 | 自动/用户协助 |
| K22 | real-device | iPhone Safari、Android Chrome、平板、macOS/Windows 桌面、键盘/屏幕阅读器、QZ Tray 与实体打印机 | 执行 [真实设备专项](real-device-test-cases.md) 中被明确选择的 `DEVICE-*` 用例 | 关键路径在真实设备可用；辅助技术无阻断；睡眠、重启、权限和实体打印恢复正确 | 用户协助/手工 |

## L. 完整通知专项

范围包括站内通知、未读计数、SignalR 实时消息、声音、浏览器后台、打印/支付告警和测试邮件。所有测试事件必须带唯一追踪 ID；禁止向真实顾客或生产收件人发送测试通知。

### L1. 前置、受众与租户隔离（10）

| ID | 优先级 | 账号/前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| NOTIF-PRE-01 | P0 | Local/Test/Staging | 记录环境、提交、浏览器、数据库 UTC、餐厅时区、SignalR endpoint 和通知渠道配置 | 环境与事件时间基线可复核；Production 写入被阻止 | Auto |
| NOTIF-PRE-02 | P0 | PlatformOwner、Owner/Admin/Staff A/B、Customer、Guest | 建立角色—餐厅—通知类别矩阵并记录初始未读数 | 每个身份、餐厅和基线计数明确；不复用生产账号 | Auto |
| NOTIF-PRE-03 | P0 | 测试订单、支付、打印任务和邮箱 | 为每种通知准备一次性 fixture 与 correlation ID | 每条通知能回溯唯一业务事件；清理范围明确 | Auto |
| NOTIF-PRE-04 | P1 | 浏览器通知/声音权限可控 | 记录 Allowed、Denied、Default、Muted 和后台 tab 基线 | 权限状态可恢复；测试不会修改用户真实浏览器配置 | Assisted |
| NOTIF-ROLE-01 | P0 | PlatformOwner | 分别触发餐厅 A/B 的订单、支付、打印和系统告警 | 平台角色按产品策略看到允许的全平台通知，且每条明确标识餐厅 | Auto |
| NOTIF-ROLE-02 | P0 | Owner/Admin A/B | 分别触发餐厅 A/B 事件 | Owner/Admin 只收到自己管理范围内的通知；跨店数量、内容和链接均不可见 | Auto |
| NOTIF-ROLE-03 | P0 | Staff A/B | 触发新订单、SLA、Ready、支付阻断和打印故障 | Staff 只收到岗位需要且属于本店的运营通知；无后台财务敏感详情 | Auto |
| NOTIF-ROLE-04 | P0 | Customer A/B | 触发本人订单、付款、退款进度和完成事件 | Customer 只收到本人订单通知；不能通过链接或 API 打开他人订单 | Auto/Assisted |
| NOTIF-ROLE-05 | P1 | Guest scoped token | 创建 Guest 订单并尝试无 token、错误 token 和另一订单 token | 只有正确 scoped token 可读取该 Guest 订单状态；无全局通知中心泄露 | Auto |
| NOTIF-ROLE-06 | P0 | Owner/Admin/Staff A + 餐厅 B 资源 ID | 直接调用通知列表、已读、清除 API 并替换 restaurantId/notificationId | 返回 403/404 且不泄露 B 的通知存在性、内容或未读数量 | Auto |

### L2. SignalR、重连与重复事件（8）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| NOTIF-RT-01 | P1 | 正常连接 | 打开 Staff Orders、Front Counter 和通知中心后触发一个事件 | 页面与通知中心在目标时间内更新一次；轮询不会再生成重复项 | Auto |
| NOTIF-RT-02 | P0 | 断开期间有事件 | 阻断 SignalR，触发订单/支付事件，再恢复连接 | 重连后通过补拉或版本同步获得缺失事件；顺序和最终状态正确 | Auto |
| NOTIF-RT-03 | P1 | 连续断连重连 | 快速断开/恢复 5 次并在每次间隔触发事件 | 只保留一个有效连接/订阅；无内存增长、重复声音或重复通知 | Auto |
| NOTIF-RT-04 | P0 | 旧连接延迟消息 | 新连接完成后向旧连接投递较旧状态 | 旧状态不能覆盖新状态；按版本/时间/事件序列收敛 | Auto |
| NOTIF-RT-05 | P1 | 多标签页 | 同一用户打开两个标签并触发一个事件 | 每个标签状态正确；持久化未读只增加一次，声音遵循单实例策略 | Auto |
| NOTIF-RT-06 | P1 | 浏览器休眠/后台 | 将标签置后台或设备睡眠，期间触发事件后恢复 | 页面恢复后补齐事件且没有风暴；过期提示不闪现为当前告警 | Assisted |
| NOTIF-RT-07 | P0 | 相同 EventId 重放 | 重放完全相同的通知/订单/Stripe/打印事件 2–10 次 | 数据库、未读计数、声音、邮件和 UI 卡片只产生一次有效副作用 | Auto |
| NOTIF-RT-08 | P0 | 同业务不同 EventId | 发送语义相同但 EventId 不同的重试事件，再发送真正的新状态 | 业务幂等键阻止重复；真正的新状态仍被处理且更新原通知 | Auto |

### L3. 已读、未读、清除和声音（11）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| NOTIF-STATE-01 | P1 | 新通知 | 从 0 条基线依次触发 1、2、N 条事件 | 未读 badge、列表和 API 数量一致；大数显示策略明确 | Auto |
| NOTIF-STATE-02 | P1 | 单条已读 | 打开一条通知或点击 Mark read | 仅目标项变为已读；计数原子减 1；刷新后保持 | Auto |
| NOTIF-STATE-03 | P1 | 全部已读 | 点击 Mark all read，同时到达一个新事件 | 操作边界前的通知全部已读；并发到达的新通知保持未读 | Auto |
| NOTIF-STATE-04 | P1 | 清除已解决项 | 清除/关闭一条已解决通知并刷新、重新登录 | 该项按策略隐藏或归档；业务审计仍保留；未解决告警不能误清 | Auto |
| NOTIF-STATE-05 | P0 | 两标签并发 | 两个标签同时已读/清除同一通知 | 操作幂等；计数不为负；两个标签最终一致 | Auto |
| NOTIF-STATE-06 | P1 | 排序与分页 | 混合已读/未读、不同优先级与同时间事件 | 排序稳定；翻页不丢不重；筛选和计数语义一致 | Auto |
| NOTIF-SOUND-01 | P1 | 权限 Default/Allowed | 首次用户手势后触发允许发声的事件 | 只在允许且完成用户手势后播放；无浏览器 autoplay 错误风暴 | Assisted |
| NOTIF-SOUND-02 | P1 | 权限 Denied | 拒绝声音/浏览器通知权限后触发事件 | 视觉通知仍可用；只出现一次可操作说明，不反复弹权限请求 | Assisted |
| NOTIF-SOUND-03 | P1 | 静音 | 开启静音、刷新、重新登录并触发多个类别 | 静音范围和持久化符合产品策略；视觉/未读不受影响 | Assisted |
| NOTIF-SOUND-04 | P1 | 浏览器后台与系统勿扰 | 前台、后台、锁屏/勿扰分别触发同一事件 | 行为符合浏览器/OS 能力并有降级；恢复前台不补播过期声音 | Manual |
| NOTIF-SOUND-05 | P1 | 声音节流 | 10 秒内触发 20 个订单/SLA 事件 | 视觉记录完整；声音聚合或限频，无连续不可控噪声 | Auto/Assisted |

### L4. Printer/Payment 恢复与邮件失败（8）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| NOTIF-REC-01 | P0 | Printer 离线→恢复 | 制造测试打印失败，确认告警后恢复 QZ/打印机并完成唯一重试 | 告警在确认成功后自动清除；失败任务仍可追溯；不重复打印 | Assisted |
| NOTIF-REC-02 | P0 | Payment 故障→恢复 | 触发可恢复支付/Webhook 故障后完成对账 | 支付告警在真实一致状态后自动清除；不能因前端刷新提前消失 | Auto |
| NOTIF-REC-03 | P0 | 多故障部分恢复 | 同时存在两个打印任务和两个支付问题，只恢复其中一个 | 只清除已恢复对象；聚合计数与剩余对象准确 | Auto/Assisted |
| NOTIF-EMAIL-01 | P0 | 邮件临时失败 | 让测试 provider 返回 timeout/429/5xx | 核心订单/支付事务不回滚；邮件进入有上限的退避重试 | Auto |
| NOTIF-EMAIL-02 | P0 | 重试后成功 | 前两次失败、第三次成功 | 只投递一封有效邮件；状态、attempt 次数和审计准确 | Auto/Assisted |
| NOTIF-EMAIL-03 | P0 | 永久失败 | 使用测试拒收/无效地址直到终止策略 | 不无限重试；授权人员收到可操作失败状态；不向普通角色泄露地址 | Auto |
| NOTIF-EMAIL-04 | P0 | Provider 回调重复/乱序 | 重放 delivered/bounced/failed 回调并改变顺序 | 最终投递状态按合法状态机收敛；不重复发信或覆盖较新状态 | Auto |
| NOTIF-EMAIL-05 | P0 | 内容与租户 | 对 A/B 店、Customer/Staff 分别生成测试邮件 | 收件人、餐厅、订单、金额、法律主体和链接正确；无 token、堆栈或他店数据 | Assisted |

## M. 全链路营业场景

这组用例验证跨页面、跨角色和跨服务的最终一致性。每轮使用唯一订单号；资金仅限 Stripe Sandbox，实体打印和测试邮件必须另行授权。

### M1. 前置与 Guest Takeaway 主链路（8）

| ID | 优先级 | 账号/场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| E2E-PRE-01 | P0 | 测试餐厅 | 记录菜单、库存、营业状态、打印路由、通知基线、报表基线和 Stripe Sandbox | 所有起始值与清理范围可复核；无 Production 资源 | Auto |
| E2E-PRE-02 | P0 | Guest、Staff 1/2、Admin、Customer | 为每个角色建立独立浏览器会话并确认餐厅范围 | 不共享 token/session；跨店辅助账号准备完成 | Auto |
| E2E-PRE-03 | P0 | 唯一 fixture | 创建带选项、过敏原、备注和库存的测试菜品 | 价格、库存和敏感备注预期明确；可在结束后恢复 | Auto |
| E2E-TAKE-01 | P0 | Guest Takeaway | 进入公开菜单、加商品/选项、填写备注并提交柜台付款订单 | 只创建一个订单；快照、金额、币种、订单类型和 Guest token 正确 | Auto |
| E2E-TAKE-02 | P0 | Staff Orders | Staff 接受订单，另一 Staff 同时观察 | 订单从 New/Needs accept 进入正确队列；第二会话实时一致 | Auto |
| E2E-TAKE-03 | P0 | Kitchen | 开始制作并完成 Kitchen 阶段 | 状态顺序合法；Kitchen、Orders、Admin Orders 和 Customer/Guest 视图一致 | Auto |
| E2E-TAKE-04 | P0 | Ready→Front Counter | 标记 Ready，在 Front Counter 搜索订单并收取现金/记录找零 | 金额与 tender 正确；未付款前不可 Complete；收款幂等 | Auto/Assisted |
| E2E-TAKE-05 | P0 | Complete | 完成订单并核对 Customer/Guest、Admin Orders、Reports、通知和库存 | 所有页面最终为 Completed/Paid；库存只扣一次；时间线和审计完整 | Auto |

### M2. Dine-in 多人加单与整桌结算（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| E2E-DINE-01 | P0 | 桌码与两个 Guest | 两台设备扫描同一桌码并加入同一桌台 Session | 两人进入正确餐厅/桌台；跨桌 token 不可访问 | Assisted |
| E2E-DINE-02 | P0 | 并发加单 | 两人同时加入不同商品，随后一人改数量 | 不丢写、不覆盖他人行；总额、版本和参与者视图一致 | Auto/Assisted |
| E2E-DINE-03 | P0 | 分批提交 | 两位 Guest 分别提交加单，Staff/Kitchen 处理 | 每次形成明确订单/批次；打印、通知和 Kitchen 不丢不重 | Assisted |
| E2E-DINE-04 | P0 | 整桌结算 | Front Counter 打开桌台，核对所有未结订单并一次结算 | 结算范围、总额、币种和 tender 正确；事务原子；部分失败可恢复 | Auto/Assisted |
| E2E-DINE-05 | P0 | 完成与重开保护 | 完成桌台 Session 后刷新、返回旧链接并尝试继续加单 | 旧 Session 不能继续写；历史可追溯；新 Session 不继承旧账单 | Auto |

### M3. 在线支付、打印、通知与 Reports（4）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| E2E-ONLINE-01 | P0 | Stripe Sandbox | Guest/Customer 下单并完成标准在线支付 | Checkout、Webhook、DineFlow Payment 和订单 Paid 状态一致；不重复扣款 | Auto |
| E2E-ONLINE-02 | P0 | 厨房打印 | 支付成功后观察打印任务、QZ 和实体票据 | 只生成一张目标餐厅票据；内容、选项、过敏原和订单号正确 | Assisted |
| E2E-ONLINE-03 | P0 | 通知 | 核对 Staff、Admin、Customer 的支付/新单提醒并重放事件 | 受众正确、跨店隔离、只提醒一次；恢复后无陈旧告警 | Auto/Assisted |
| E2E-ONLINE-04 | P0 | Reports | 核对 Orders/Payments/Activity/CSV 和 Stripe Dashboard | 金额、币种、手续费、净额、时间和餐厅范围一致 | Auto |

### M4. 部分退款与跨系统一致性（4）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| E2E-REF-01 | P0 | 已支付多商品订单 | Admin 对指定商品提交部分退款 | 分配不超过商品和订单可退余额；Stripe 只退目标金额 | Auto |
| E2E-REF-02 | P0 | Webhook/对账 | 延迟或重放退款事件后执行同步 | 最终状态幂等收敛；不出现本地成功、Stripe 失败的假退款 | Auto |
| E2E-REF-03 | P0 | 四端核对 | 核对 Staff Orders、Customer/My Orders、Admin Payments/Reports 和 Stripe | 退款金额、状态、原因、时间和剩余余额一致 | Auto |
| E2E-REF-04 | P1 | 通知/收据 | 核对退款通知、邮件和更新后的收据/CSV | 只通知正确受众一次；收据与报表反映原额、退款和净额 | Auto/Assisted |

### M5. 两个 Staff 并发同单（4）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| E2E-RACE-01 | P0 | 同状态提交 | Staff 1/2 同时 Accept 同一订单 | 只发生一次合法迁移；另一请求幂等或得到明确冲突 | Auto |
| E2E-RACE-02 | P0 | 不同状态提交 | 一人 Start cooking，另一人基于旧版本 Ready/Complete | 旧版本不能跳状态或覆盖新状态；页面重新同步 | Auto |
| E2E-RACE-03 | P0 | 收款并发 | 两个 Front Counter 会话同时 Pay/Complete 同一订单 | 只记录一次收款和完成；余额、找零、审计不重复 | Auto |
| E2E-RACE-04 | P0 | 状态+退款/打印并发 | 一人完成/退款，另一人重试打印或刷新 | 财务状态优先且一致；打印按最终合法状态处理；通知不重复 | Auto/Assisted |

## N. 运营与发布专项

所有迁移、恢复、告警、保留和压力测试仅能在 disposable Local/Test/Staging 环境执行。不得对 Production 数据库做恢复、故障注入、批量写入或压力测试。

### N1. 数据库 Migration（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-MIG-01 | P0 | 空数据库 | 使用发布流程从零运行全部 migration，再启动 API | schema 完整；启动成功；无 Demo 用户/密码或隐式 Seeder | Auto |
| OPS-MIG-02 | P0 | 上一正式版本数据 | 恢复旧版本备份，运行升级 migration 并抽查关键表 | 订单、支付、退款、用户、餐厅、审计数据保留且约束正确 | Manual |
| OPS-MIG-03 | P0 | 两个 API 实例 | 同时启动两个实例并运行独立 migration task | migration 只执行一次；应用副本不竞争迁移；启动门禁清楚 | Manual |
| OPS-MIG-04 | P0 | migration 中断 | 在 disposable DB 中断长 migration 后重试 | 无半完成 schema/损坏数据；重试或回滚步骤明确、可重复 | Manual |
| OPS-MIG-05 | P1 | 兼容窗口 | 新旧 API 短时并存读取升级中 schema | 支持的 rolling window 无 5xx/错写；不支持时部署流程明确阻止 | Manual |

### N2. Backup Restore（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-BAK-01 | P0 | 自动备份 | 检查计划、保留期、加密、失败告警和最近成功时间 | RPO 配置符合政策；备份失败可被发现 | Manual |
| OPS-BAK-02 | P0 | 全量恢复 | 恢复最近备份到隔离目标并记录耗时 | 在目标 RTO 内可启动；不覆盖源数据库 | Manual |
| OPS-BAK-03 | P0 | 数据对账 | 对比恢复前后样本订单、支付、退款、审计和用户权限 | 数量、金额、外键和不可变审计一致 | Auto/Manual |
| OPS-BAK-04 | P0 | 时间点恢复 | 恢复到指定交易前后时间点 | 恢复边界符合声明的 RPO；丢失窗口可量化且记录 | Manual |
| OPS-BAK-05 | P1 | 密钥/权限/清理 | 用非授权角色尝试恢复，完成后销毁测试目标 | 最小权限生效；恢复日志可审计；测试副本安全清理 | Manual |

### N3. 多实例部署（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-SCALE-01 | P0 | 两个以上 API 实例 | 经负载均衡连续访问 API、Auth 和 SignalR | 无会话粘滞依赖；身份与实时连接稳定 | Manual |
| OPS-SCALE-02 | P0 | 滚动发布 | 保持下单/Staff 页面打开并逐个替换实例 | 请求无大面积 5xx；SignalR 自动重连；未完成写入可安全重试 | Manual |
| OPS-SCALE-03 | P0 | 单实例故障 | 强制终止一个测试实例 | 流量转移；健康检查摘除故障实例；订单/支付无重复 | Manual |
| OPS-SCALE-04 | P0 | 后台任务 | 多实例同时运行通知、邮件、保留或对账 worker | 通过租约/队列只执行一次或业务幂等；无重复副作用 | Manual |
| OPS-SCALE-05 | P1 | 配置一致性 | 对比所有实例版本、环境变量、时区和密钥引用 | 配置/版本一致；漂移被启动检查或监控发现 | Auto/Manual |

### N4. API/DB/Stripe 告警（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-ALERT-01 | P0 | API 5xx/不可达 | 触发受控 synthetic failure | 在目标时间内通知指定测试值班渠道；包含环境/服务/追踪 ID，无秘密 | Manual |
| OPS-ALERT-02 | P0 | DB 连接/容量 | 阻断测试 DB 或触发连接池/磁盘阈值 | 告警准确分级；应用降级安全；恢复后自动关闭并记录持续时间 | Manual |
| OPS-ALERT-03 | P0 | Stripe Webhook | 暂停 listener、制造签名失败或积压 | 检测延迟/失败率/积压；不因单个恶意请求造成告警风暴 | Manual |
| OPS-ALERT-04 | P1 | 去重与升级 | 同一故障持续、抖动并跨升级阈值 | 告警按 fingerprint 去重；升级和恢复通知各一次；时间线完整 | Manual |
| OPS-ALERT-05 | P1 | Runbook | 从告警链接执行只读诊断和恢复演练 | 链接、负责人和步骤有效；不要求聊天中暴露密钥 | Manual |

### N5. 数据保留任务（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-RET-01 | P0 | 到期测试数据 | 将各类记录推进到保留期并运行任务 | 按政策删除或不可逆去标识化；未到期数据不受影响 | Auto |
| OPS-RET-02 | P0 | Legal hold | 对一组记录设置法律保留再运行任务 | 被 hold 的记录保留且原因/操作者可审计 | Auto |
| OPS-RET-03 | P0 | 跨表完整性 | 到期 Customer、Guest、订单附件、通知和日志联动清理 | 无孤儿 PII、断裂外键或误删财务/法定记录 | Auto |
| OPS-RET-04 | P1 | 幂等/并发 | 重复运行任务并让两个 worker 同时启动 | 结果相同、无重复审计/异常；只有一个有效执行者或操作幂等 | Auto |
| OPS-RET-05 | P1 | 报告与失败恢复 | 中途失败后重跑并核对指标/审计 | 记录扫描、处理、跳过、失败数量；可从安全边界继续 | Auto |

### N6. 长时间运行、断网、重启与恢复（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-REC-01 | P1 | 8–24 小时 soak | 保持 Dashboard、Staff Orders、Front Counter 和通知页面运行 | 无持续内存/连接增长、轮询风暴、过期会话死循环或时间漂移 | Manual |
| OPS-REC-02 | P0 | 客户端断网 | 在加购物车、提交订单、状态变更和收款边界分别断网 | 不假成功；恢复后能判断是否已提交；重试不重复订单/收款 | Auto/Assisted |
| OPS-REC-03 | P0 | API/worker 重启 | 在订单、Webhook、退款、邮件和打印任务处理中重启 | 持久任务恢复；已完成副作用不重复；失败可操作 | Manual |
| OPS-REC-04 | P0 | DB 短暂故障 | 在读写高峰制造短暂连接失败并恢复 | 熔断/重试有上限；事务不半写；恢复后状态收敛 | Manual |
| OPS-REC-05 | P1 | 浏览器/设备重启 | 关闭浏览器或重启设备后恢复 Guest、Customer 和 Staff 流程 | session/token 按策略恢复或安全失效；无跨账号残留 | Assisted |

### N7. 批量订单与性能压力（5）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| OPS-LOAD-01 | P0 | 批量订单 | 在隔离环境生成分阶段 50/200/1000 单并记录延迟/错误率 | 不丢单、不重复；订单号唯一；达到容量阈值时安全限流 | Manual |
| OPS-LOAD-02 | P0 | 并发结账 | 多 Guest/Customer 同时下单与创建 Stripe Sandbox Checkout | 库存、幂等、金额和 connected account 归属正确 | Manual |
| OPS-LOAD-03 | P0 | Staff/Front Counter | 多会话同时搜索、筛选、变更状态和收款 | P95/P99 在约定目标内；并发冲突明确；页面无冻结 | Manual |
| OPS-LOAD-04 | P1 | SignalR/通知/打印队列 | 批量订单同时触发实时事件、通知和测试打印任务 | 事件可控聚合；队列有背压；顺序、去重和租户路由正确 | Manual |
| OPS-LOAD-05 | P1 | 报表/导出与清理 | 压力后加载 Reports/CSV，核对 DB 并删除专用测试数据 | 报表总数/金额一致；导出有上限；清理不影响非测试数据 | Auto/Manual |

## 回归签字模板

| 版本/提交 | 环境 | 执行人 | 日期 | P0 数量 | P1 数量 | 结论 |
|---|---|---|---|---:|---:|---|
|  |  |  |  |  |  |  |

发布门槛建议：P0 必须为 0；P1 必须关闭或由负责人书面接受并设置期限；所有付款、退款、打印、备份恢复和监控场景必须有真实环境证据。
