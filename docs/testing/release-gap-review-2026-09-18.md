# 上线测试缺口与接力清单 — 2026-09-18

## 口径

复核 09-16 生产总报告及 payment-system、front-counter、cart、shared-cart、admin-modules、write-paths、profile-security 专项报告。专项后续结果未全部回填总矩阵；下表承认已有证据，不要求从头重跑。历史通过不代表当前发布版本和环境已验证。

本轮仅本地：分支 `jianda-payment-test-2026-09-16`，提交 `34362f9`。使用独立临时 PostgreSQL；不更改生产、不打印、不发送邮件、不调用真实支付。未修改业务代码。

## 本轮执行

- 前端 `npm test -- --reporter=dot`：123 文件、1093 测试全部通过。仍有 React act 测试警告和 Vite native loader 兼容提示。
- 前端 `npm run build`：通过；这不是生产环境变量/部署验收。
- 前端 `npm run lint`：通过。
- 后端定向测试：513 PASS / 0 FAIL / 0 SKIP。过滤 Cart、Refund、StaffOrder、Payment、Stock、FrontCounter、TableSettlement、Dashboard、Authorization；包含源码契约、单元和 PostgreSQL 集成测试，不能把总数解释成 E2E 场景数。使用 .NET 8 SDK 和独立无持久卷 PostgreSQL 16；原始证据 `test-results/20260918-002751/logs/core-results.trx`（本地生成产物，不入 Git）。编译仍有 PrivacyRequestApiTests.cs:133 的 CS8604 警告。
- 上次两项删除菜品测试的营业时间夹具已有 AlwaysOpenHoursJson 修复，本轮验证；不沿用旧失败结论。

## 各模块真正剩余的工作

本清单之后的执行增量见 [非打印补测](non-printing-followup-2026-09-18.md)：已补 Customer 先提交/第二 Customer 重试归属、40 次加菜、addon 库存竞争，以及模拟 Stripe 的退款审核正向 API。Guest 抢先提交仍存在 P1 需求差异，浏览器实时和真实 Stripe 对账未关闭。

| 模块 | 已有证据（历史） | 首店上线前剩余验收 | 执行方式 |
|---|---|---|---|
| Cart / 共享点餐 | 29 项价格与重校验、9 项共享并发，以及本地并发/库存 | Customer+Guest、两个 Customer 的订单归属；双浏览器实时、断网恢复、过期恢复；addon 库存端到端 | 我跑独立账号/API与双浏览器，真实手机恢复接力 |
| Staff Orders | 权限、接单、支付阻断 API；队列 UI 抽查 | 两个 Staff 同时流转、断线补单；顾客→厨房→柜台→完成四端一致 | 我跑，打印另交接 |
| Front Counter | 60 项 API、整桌结算、冲正、线上线下互斥 | 双柜台同单收款；取餐/整桌 UI、找零与收据；重启后恢复 | 我跑 UI/隔离并发，你核对收据 |
| Payment System | 生产 Sandbox 成功/拒付、direct charge、部分/全额退款 | 3DS 成功/失败/关闭；webhook 延迟/重放与浏览器回跳；拒单同时付款；启用的异步方式如 Klarna | 我在已确认 Sandbox 的专用订单跑；真实 live 另授权接力 |
| Admin Payments / 退款 | 权限、金额上限、重复退款、分页 | 顾客提出申请→Admin 批准/拒绝→状态回传；处理中失败恢复；四端退款余额和 item/addon 回库存策略核对 | 我跑 Sandbox 专用订单，不动历史款项 |
| Admin Orders | 17 项状态机、支付资格、历史 | 详情/历史/退款显示、搜索分页；实时更新与旧版本冲突提示 | 我跑浏览器 |
| Admin Menu | 创建编辑删除、价格与库存联动、跨商品 option 拒绝 | 图片上传/替换、过敏原与选项渲染、allergenInfoLastVerifiedAt；售罄后顾客端实时反应 | 我跑；真实票据你核对 |
| Admin Restaurants | 权限、暂停恢复、常规营业时间及冲突 | 特殊营业日、时区/跨午夜、桌码生命周期；正式餐厅资料与 Stripe 商户身份核对 | 我跑本地；你确认真实资料 |
| Admin Users | 权限与禁止越权写 | 专用账号创建/角色变更/停用启用；旧会话失权；邀请邮件若首发启用 | 我跑；邮箱/认证必要时交接 |
| Dashboard | 读取和部分库存/配置策略 | 指标与订单实数对账；暂停/恢复、特殊日、快捷库存、布局持久化 UI | 我跑本地 |
| Admin Reports | 32 项权限/隐私/导出；后续金额字段与 sortBy 已复测 | 支付与部分退款后的汇总/CSV逐分对账；日期/时区边界；修复版本与正式部署一致 | 我跑，不重复旧 API 探针 |
| Notifications / SignalR | 徽章与基础更新抽测 | 双会话断线补齐、重复事件、旧消息不覆盖新状态；支付/打印故障恢复；邮件失败不能阻塞订单 | 我跑隔离故障；声音/设备后台你接力 |
| Login / Profile | 密码、Magic Link、MFA 多轮证据 | 邮箱变更、重置后旧 refresh 会话撤销验证；投递垃圾箱问题复查；Passkey 若开放 | 我跑安全验证，认证手势你接力 |
| Real Device / Printing | 自动化格式或连接不算实机通过 | iPhone Safari、Android、首店终端、平板关键链路；厨房票/收据、断连补打、30–50 单清点 | 你操作设备，我逐项观察记录 |
| 运营发布 / 清库 | 总报告缺完整发布验收记录 | 清库副本演练、备份实际恢复、迁移/无 demo seed、告警到达、服务重启恢复；按实际部署确认单/多实例范围 | 我准备隔离演练，你授权正式操作；不自动清生产库 |

## 固定顺序与停止条件

1. 我先完成账号归属、退款审批及浏览器跨角色链路；不再扩大随机测试范围。
2. 核对最终部署方案后完成备份/恢复/清库演练。
3. 接力顺序：一张厨房票→一张柜台收据→断连恢复→编号批量清点→手机关键链路。
4. 固定发布 commit，适用 P0 全部有通过证据；影响资金、权限、漏单的 P1 关闭，其余逐项接受风险及期限。BLOCKED/NOT RUN 不当 PASS。
5. 公开下单前，另行授权的低金额真实支付与全额退款验收。Sandbox 历史通过不替代 live。

上述清单是剩余验收，不是本轮已经执行的项目。本轮未运行新的浏览器双会话、真实 Stripe 回调或实机打印验收，未发现新的确认缺陷。后续修复仅回归受影响模块和关键冒烟，不要求每次重跑全部专项。
