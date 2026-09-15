# DineFlow 全功能发布测试报告

测试日期：2026-08-09  
环境：本机开发环境、PostgreSQL、Stripe Sandbox、QZ Tray 2.2.6  
代码分支：`jianda`，测试开始时 HEAD 为 `af5ab89`  
证据目录：`/Users/jiandahou/Documents/Codex/2026-08-08/mvp-mvp-4-seeder-program-cs/outputs/full-system-test-2026-08-09`

## 结论

功能型 MVP 的主要路径可用，多角色权限隔离、公开菜单、购物车、柜台付款、管理后台、Stripe 导入和 QZ Tray 连接均得到验证。但当前版本仍不建议直接开放真实饭店长期营业。

本轮发现 4 类发布阻塞：

1. 生产启动仍会自动迁移并无条件执行完整 Demo Seeder。
2. 登录缺少专用限流和连续失败锁定，密码最短仍为 6 位，登录页还硬编码演示账号密码。
3. Stripe 实际付款能最终变为 `Paid`，但成功回跳把 `{CHECKOUT_SESSION_ID}` 编码成普通文本，顾客页会卡在确认中。
4. 正式部署配置未闭环：前端 CD 的 API 地址为空、法律主体变量未注入、CI 不执行测试或 lint。

因此，本报告给出的判断是：**可以继续内部试用和有人员值守的 Sandbox/演练环境测试；在 P0 全部关闭之前，不应接真实顾客、真实卡款或长期保存真实个人信息。**

这是一份工程与产品合规检查，不替代澳大利亚执业律师、隐私顾问或食品安全专业人员的正式意见。

## 测试规模

| 项目 | 结果 |
|---|---:|
| 浏览器截图 | 53 张 |
| 身份类型 | 6 类（Platform Owner、Restaurant Owner、Admin、Staff、Customer、Guest） |
| 前端单元/组件测试 | 173/173 通过（指定 Node 24 且关闭 experimental webstorage） |
| 后端测试 | 237 通过、4 跳过，共 241 |
| 前端 lint | 77 errors、9 warnings，失败 |
| 前端生产构建 | 通过 |
| npm 生产依赖树审计 | 13 项：8 high、3 moderate、2 low |
| NuGet 依赖审计 | 2 个 high 级传递依赖 |

## 多账号验证结果

| 身份 | 主要验证 | 结果 | 证据 |
|---|---|---|---|
| Platform Owner | Dashboard、Users、Restaurants、Orders、Menu、Payments、Reports | 通过 | `02`–`08` |
| Platform Owner | Staff orders、Front counter、Profile | 通过 | `09`–`11` |
| Restaurant Owner | 只看到自己的餐厅、用户与报表 | 通过 | `12`–`15` |
| Admin | 自己餐厅的 Dashboard、Users、Payments | 通过 | `16`–`18` |
| Staff | Staff orders、Front counter、Admin orders | 通过 | `19`–`21` |
| Staff | 直接访问 Users、Payments、Restaurants | 通过：被重定向至 `/me` | `22`–`24` |
| Customer | Profile、My orders | 通过 | `25`–`26` |
| Customer | 直接访问 Admin/Staff 路由 | 通过：被阻止 | `27`–`28` |
| Guest | 订单类型、菜单、搜索、菜品、购物车、结账 | 基本通过 | `29`–`34` |

权限隔离测试没有发现跨餐厅数据直接泄漏。受保护路由会阻止 Staff/Customer 进入高权限页面，但目前是静默重定向，没有明确说明“权限不足”，属于次要体验问题。

## 订单、支付与退款

| 场景 | 结果 | 说明 | 证据 |
|---|---|---|---|
| Takeaway 公开菜单下单 | 通过 | 创建 `ORD-20260809-611956` | `30`–`34` |
| Stripe Sandbox 成功付款 | 部分失败 | Stripe 收款完成，管理端最终为 Paid；顾客成功页卡在确认中 | `35`、`36`、`46` |
| Stripe 取消付款 | 通过 | 显示未扣款并可进入 My orders | `53` |
| 柜台付款（Takeaway） | 通过 | 文案为取餐时柜台付款 | `38` |
| 柜台付款（Dine-in） | 通过 | 文案为餐后柜台付款 | `39` |
| 退款弹窗 | 通过（未提交） | 支持剩余余额或按商品分配；本轮未产生真实退款 | `47` |
| 退款请求列表 | 通过 | 无匹配请求时空状态正常 | `48` |

Stripe 成功回跳问题有明确代码证据：`StripeOrderCheckoutService.AppendSessionId` 使用 `QueryHelpers.AddQueryString` 添加 Stripe 特殊占位符，导致花括号被 URL 编码。Stripe 没有替换它，前端收到的是 `%7BCHECKOUT_SESSION_ID%7D`。Webhook/后台恢复最终能把支付改成 Paid，但顾客当下会误以为支付仍在确认。

本轮未完成 declined card、3DS、延迟 webhook、重复 webhook 和真实退款到账验证，应在修复回跳后按测试用例继续执行。

## 菜单、食品信息与澳大利亚合规

已验证：

- 结账前可访问 Customer Terms、Privacy、Refunds & cancellations、Allergen information。
- 餐厅编辑页可预览 Stripe 建议字段，默认不覆盖非空值，ABN/GST/收费政策保留人工确认。
- 菜品编辑器具备 `Allergens`、`May contain / cross-contact allergens` 与交叉接触说明字段。
- 生产环境后端会检查法律主体名称、11 位 ABN、地址、隐私邮箱与支持邮箱是否配置。

仍存在的问题：

- 当前公开菜单的 `Market Arancini` 图片内容是 Chicken Wings，同时过敏原、可能含有和交叉接触字段为空，却展示 Vegetarian/Halal 标签。测试数据不能进入真实营业环境。
- 当前结账页显示的 ABN `12345678901` 未通过澳大利亚 ABN checksum；代码只检查“11 位数字”。
- 当前退款邮箱示例为 `2@gmail.com`，不是合适的正式客服身份。
- 顾客填写的 Allergy notes 可能包含健康信息，界面没有单独说明收集目的、访问范围与保留时间。
- 数据保留周期只有文档与 UI 展示，尚未发现执行删除/去标识化的定时任务。
- 隐私请求有创建和“我的请求”API，但缺少完整顾客入口与后台处理工作台。
- Frontend CD 未注入 `VITE_LEGAL_*`，生产前端仍可能显示空白或回退法律主体。

## 打印验证

QZ Tray 显示已连接，版本 2.2.6；系统打印机 `star` 可被识别，连接测试结果为 `Passed`。见 `49`–`51`。

本轮为了避免无意产生实体票据，没有点击 `Print test ticket`，也没有执行断线、缺纸、睡眠、重启、积压队列或连续 30–50 单测试。这些必须在首店真实硬件上完成，不能因为“连接通过”就视为打印验收完成。

## 自动化质量结果

### 通过

- 前端生产构建通过。
- 前端在项目指定运行方式下 28 个测试文件、173 个测试全部通过。
- 后端 Docker .NET 8 环境下 237 个测试通过。
- 5xx 错误详情不会再直接进入普通 API 错误 toast；错误登录只显示简短 `Login failed`。

### 失败或不稳定

- 普通 `npm test` 在本机 Node 26 下因 experimental `localStorage` 行为失败；显式使用 Node 24 并添加 `--no-experimental-webstorage` 才通过。
- 4 个 PostgreSQL 并发测试被跳过，其中包括 MFA 首次并发更新以及 void/refund/offline refund 竞争条件。
- lint 有 77 个错误、9 个警告，包括 React Hooks 声明顺序、依赖和 effect 中 setState 等真实质量问题。
- 构建产物存在大 chunk 警告：主 JS 约 1.83 MB、CSS 约 762 KB。

## 依赖安全审计

`npm audit --omit=dev` 报告 13 项生产依赖树告警（8 high、3 moderate、2 low），包括 `react-router`、`postcss`、`js-yaml`、`fast-uri`、`brace-expansion` 等。它们多数为传递依赖，仍应逐项确认实际运行可达性并升级 lockfile，而不能只按包名判断业务一定可利用。

NuGet 官方漏洞源报告两个 high 级传递依赖：

- `Microsoft.Extensions.Caching.Memory 8.0.0`
- `System.Text.Json 8.0.4`

发布前应升级到受支持的 .NET 8 patch 版本并重新执行测试与漏洞扫描。

## 未执行/需真实环境验收

- Google、Facebook 的真实生产域名 OAuth 回调。
- Magic Link 邮件投递、登录后 MFA 完整链路。
- Passkey 在 Safari、Edge、Windows Hello、Touch ID 上的注册与登录。
- Stripe declined card、3DS、延迟/重复 webhook、争议与真实退款到账。
- 真实打印机断线、缺纸、Mac 睡眠/重启与 30–50 单压力测试。
- 手机 Safari/Chrome、平板、屏幕阅读器与键盘全流程。
- RDS 自动备份和至少一次恢复演练。
- ECS、RDS、API、Stripe webhook 告警与值班通知。

## 截图索引

截图文件名已按执行顺序编号。重点证据：

| 文件 | 内容 |
|---|---|
| `01-login-desktop.jpg` | 登录页硬编码演示凭据 |
| `19-staff-orders.jpg` | Staff 工作台与 Stripe 未连接通知 |
| `22`–`24` | Staff 越权访问被阻止 |
| `27`–`28` | Customer 越权访问被阻止 |
| `32-item-detail.jpg` | 菜品图片、标签与缺失过敏原信息 |
| `34-guest-checkout.jpg` | 顾客结账与法律链接 |
| `36-stripe-success-placeholder.jpg` | 成功回跳 session 占位符未替换 |
| `41-register-six-character-password.jpg` | 6 位密码可以满足创建条件 |
| `44-stripe-business-import-preview.jpg` | Stripe 字段对比预览 |
| `45-menu-item-allergen-fields.jpg` | 过敏原字段存在但当前数据为空 |
| `46-admin-payment-paid-status.jpg` | 管理端最终显示 Paid |
| `47-refund-dialog.jpg` | 按余额/商品退款表单 |
| `51-printer-connection-result.jpg` | QZ Tray 连接测试 Passed |
| `53-payment-cancelled.jpg` | 取消付款结果页 |

完整缺陷与修复顺序见 `full-system-issue-tracker-2026-08-09.csv`，可重复操作步骤见 `full-system-test-cases.md`。
