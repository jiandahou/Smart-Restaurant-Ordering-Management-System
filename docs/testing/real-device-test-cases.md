# DineFlow 真实设备专项测试

测试包：`real-device`  
Case ID：`DEVICE-*`  
用途：在真实手机、平板、桌面浏览器、辅助技术和 QZ Tray/热敏打印机上验证关键营业路径。  
默认行为：不执行。只有用户明确请求 `real-device`、`DEVICE-*` 或 `full` 时才运行。

## 1. 安全与执行规则

- 优先使用 Local/Test/Staging、测试账号、Stripe Sandbox、测试邮箱和专用打印队列。
- 不得在 Production 做压力、断网、浏览器清理、打印队列清理、真实卡付款或真实顾客通知。
- Agent 可以准备页面、发起已授权的测试打印并保存最小证据；触屏手势、屏幕阅读器、系统权限、实体票据、切纸、声音和设备重启由用户观察。
- 用户未报告实体结果前，相关用例保持 `BLOCKED` 或 `NOT RUN`，不能仅凭 QZ “Connected” 标记 PASS。
- 截图不得包含密码、OTP、完整 token、Cookie、卡号、私人通知内容或与测试无关的设备资料。
- 每台设备记录型号、OS、浏览器及版本、viewport/缩放、输入方式、网络和时区；不要只写“手机正常”。
- 打印用例必须使用编号订单和可恢复测试数据；未经明确授权不得清空 OS/QZ 队列。

## 2. 推荐设备矩阵

| 设备 | 最低组合 | 主要范围 |
|---|---|---|
| iPhone | 当前支持的 iOS + Safari，至少一个 390px/430px 宽度 | Guest/Customer、Stripe 回跳、权限、后台恢复 |
| Android | 当前支持的 Android + Chrome | Guest/Customer、软键盘、返回键、后台恢复 |
| iPad/Android tablet | Safari/Chrome，横屏和竖屏 | Admin/Staff、表格、弹窗、触控布局 |
| macOS | Safari + Chrome，QZ Tray | Staff Orders、Front Counter、打印、睡眠/唤醒 |
| Windows | Edge + Chrome，可用时连接 QZ/打印机 | Admin、键盘、下载、Windows Hello/打印 |
| 辅助技术 | VoiceOver/TalkBack/NVDA/VoiceOver macOS 至少一种 | 标题、名称、焦点、实时状态、错误恢复 |

## 3. 前置检查（6）

| ID | 优先级 | 前置/角色 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-PRE-01 | P0 | 测试负责人 | 记录环境、提交、服务地址并确认 Stripe 为 Sandbox | 目标不是误用 Production；外部副作用范围明确 | Auto |
| DEVICE-PRE-02 | P1 | 每台设备 | 记录型号、OS、浏览器版本、viewport、缩放、语言、时区和网络 | 结果能关联到精确设备组合 | Assisted |
| DEVICE-PRE-03 | P0 | Guest、Customer、Staff、Admin A/B | 建立隔离会话并确认餐厅、角色和初始路由 | 不共享 Cookie/token；跨店账号范围明确 | Auto/Assisted |
| DEVICE-PRE-04 | P0 | 测试订单/支付/桌台 | 准备一次性 Takeaway、Dine-in、已支付、可退款和 Ready fixture | 每条 Case 有唯一 ID；金额、状态和清理方法记录 | Auto |
| DEVICE-PRE-05 | P0 | QZ/打印机 | 记录 QZ 版本、证书/签名模式、打印机名、纸宽、路由、纸张和 OS 队列基线 | 不因空签名或错误证书弹出不可信授权；目标队列明确 | Assisted |
| DEVICE-PRE-06 | P1 | 权限/隐私 | 记录通知、声音、相机、剪贴板、下载和弹窗权限基线 | 权限可恢复；不改变用户个人浏览器配置或读取无关数据 | Assisted |

## 4. 手机 Safari/Chrome（12）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-MOB-01 | P1 | Login/Register | 在 iPhone Safari 和 Android Chrome 打开登录、注册、忘记密码 | 无横向溢出；软键盘不遮住输入/Submit；autocomplete 与密码显示正常 | Assisted |
| DEVICE-MOB-02 | P1 | OAuth/Magic Link 回跳 | 从外部浏览器/邮件返回 DineFlow | state/session 正确恢复；返回键不重复登录或泄露错误页 | Assisted |
| DEVICE-MOB-03 | P0 | 公开菜单 | 搜索、筛选、打开长名称/长描述/图片/过敏原商品 | 卡片、弹窗和底部动作可达；隐藏/sold-out 状态准确 | Assisted |
| DEVICE-MOB-04 | P0 | Cart | 加减商品、选项、备注、删除/恢复并旋转设备 | 数量和金额不丢；抽屉可滚动；旋转不重复请求 | Assisted |
| DEVICE-MOB-05 | P0 | Checkout | 完成 Takeaway/Dine-in、法律同意和 Guest/Customer 下单 | 固定底部按钮不被 Safari 工具栏/软键盘遮挡；只创建一个订单 | Assisted |
| DEVICE-MOB-06 | P0 | Stripe Hosted Checkout | 完成成功、decline、取消和 3DS 后返回 | 回跳路由、sessionId、订单和支付状态收敛；Back/Refresh 不重复扣款 | Assisted |
| DEVICE-MOB-07 | P0 | My Orders/Guest order | 打开订单、刷新、从通知/深链进入并尝试他人 token | 自己的订单完整；错误 token 安全拒绝；状态和金额一致 | Assisted |
| DEVICE-MOB-08 | P1 | Staff Orders | 在手机打开 Orders/Kitchen、搜索、筛选和状态动作 | 卡片与动作可达；无 hover-only 控件；状态更新不误触 | Assisted |
| DEVICE-MOB-09 | P0 | Front Counter | 搜索订单、输入 tender、观察找零并确认前停止 | 数字键盘/小数输入正确；金额/按钮可见；本用例不实际收款 | Assisted |
| DEVICE-MOB-10 | P1 | Admin 页面 | 打开 Dashboard、Orders、Menu、Payments、Reports 的关键详情/弹窗 | 表格有可用小屏替代；弹窗可滚动并关闭；无底部内容不可达 | Assisted |
| DEVICE-MOB-11 | P1 | 前后台切换 | 下单/支付/Staff 页面在后台停留后恢复，并切换网络 Wi-Fi↔移动数据 | session 按策略保持；SignalR/轮询恢复；无重复 toast/声音/提交 | Assisted |
| DEVICE-MOB-12 | P1 | 返回/手势/刷新 | 使用系统返回、边缘返回、下拉刷新、快速双击和长按 | 导航不绕过确认或重复写入；加载和 disabled 状态清楚 | Assisted |

## 5. 平板与触控布局（6）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-TAB-01 | P1 | 横竖屏 | 在公开菜单、Cart、Dashboard、Staff Orders 和 Front Counter 切换方向 | 布局重新排版；不丢筛选、表单或选中餐厅 | Assisted |
| DEVICE-TAB-02 | P1 | 触控目标 | 对图标按钮、tabs、筛选、数量、关闭和状态操作做触控 | 目标尺寸足够且有可访问名称；相邻按钮不易误触 | Assisted |
| DEVICE-TAB-03 | P1 | Admin 长表格 | 查看 Users/Orders/Payments/Reports，展开详情和翻页 | 水平滚动/卡片替代明确；sticky 区域不遮住数据 | Assisted |
| DEVICE-TAB-04 | P1 | 长表单/弹窗 | 编辑 Restaurant/Menu/User，打开日期、select、图片和底部 Save | 所有字段/错误/Cancel/Save 可达；软键盘后仍能滚动 | Assisted |
| DEVICE-TAB-05 | P1 | Dashboard 布局 | 使用触控移动/调整 widget，随后取消、保存和刷新 | 触控有明确替代；布局不意外移动；保存范围不串账号/餐厅 | Assisted |
| DEVICE-TAB-06 | P1 | Split View/多任务 | 以 50%/33% 宽度运行并在应用间切换 | 响应式按实际宽度工作；恢复后无空白页或过期 overlay | Assisted |

## 6. 键盘、屏幕阅读器、缩放与视觉模式（12）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-A11Y-01 | P0 | 键盘登录/注册 | 仅用 Tab、Shift+Tab、Enter、Space 完成表单和取消 | 顺序合理、焦点可见、无陷阱；Enter 不重复提交 | Assisted |
| DEVICE-A11Y-02 | P0 | 键盘菜单/Cart/Checkout | 仅用键盘选择商品、选项、数量、法律链接和结账 | 所有动作可用；必选/错误被聚焦并清楚宣读 | Assisted |
| DEVICE-A11Y-03 | P1 | 键盘 Admin/Staff | 操作 tabs、筛选、表格行、对话框和状态按钮 | 不依赖鼠标 hover/拖拽；有等价键盘操作 | Assisted |
| DEVICE-A11Y-04 | P0 | 焦点管理 | 打开/关闭嵌套弹窗、toast、菜单和确认框 | 焦点进入正确容器、被适当限制，关闭后回到触发控件 | Assisted |
| DEVICE-A11Y-05 | P0 | 屏幕阅读器页面结构 | 检查所有关键页标题、landmark、导航和跳过链接 | 每页唯一 H1；区域名称清楚；重复导航可跳过 | Assisted |
| DEVICE-A11Y-06 | P0 | 控件名称/状态 | 检查图标按钮、switch、tabs、数量、排序和密码显示 | 名称、角色、状态和值准确；不只读出“button”或 glyph | Assisted |
| DEVICE-A11Y-07 | P0 | 实时/错误消息 | 触发验证、网络失败、新订单、支付和打印告警 | live region 不沉默也不重复轰炸；错误与字段关联 | Assisted |
| DEVICE-A11Y-08 | P1 | 数据表/卡片 | 阅读 Orders、Payments、Reports 表格和移动端卡片 | header 与 cell 关系明确；金额/状态/操作顺序可理解 | Assisted |
| DEVICE-A11Y-09 | P1 | 200%/400% zoom | 在关键页放大并完成登录、菜单、Cart 和一个 Admin 弹窗 | 内容重排且不被裁切；无需二维滚动完成任务 | Assisted |
| DEVICE-A11Y-10 | P1 | 高对比/深色模式 | 开启系统高对比、深色和强制颜色模式 | 文字、边框、焦点和状态仍可辨；无透明文字/不可见图标 | Assisted |
| DEVICE-A11Y-11 | P1 | Reduced motion | 开启减少动态效果并触发加载、toast、drawer、dialog | 非必要动画减少；状态变化仍明确且不依赖动画 | Assisted |
| DEVICE-A11Y-12 | P0 | 不只依赖颜色/声音 | 检查 Paid/Failed/Ready/SLA/Printer 告警 | 每个状态同时有文字/图标或程序化名称；静音后信息仍完整 | Assisted |

## 7. 桌面浏览器与系统权限（6）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-DESK-01 | P0 | macOS Safari/Chrome | 完成登录、Guest 下单、Staff 状态和 Admin 查看 | 关键路径一致；Safari/Chrome 无特有阻断 | Assisted |
| DEVICE-DESK-02 | P0 | Windows Edge/Chrome | 完成相同关键路径并比较下载/弹窗行为 | Edge/Chrome 无特有阻断；系统返回/刷新安全 | Assisted |
| DEVICE-DESK-03 | P1 | 多窗口/多显示器 | 将弹窗、Stripe、Staff 页面分布到不同窗口/屏幕 | 状态和焦点不串；关闭子窗口有恢复路径 | Assisted |
| DEVICE-DESK-04 | P1 | Clipboard/QR/下载 | 允许和拒绝 Copy、QR 下载、CSV/receipt 下载 | 成功内容准确；拒绝时短提示且页面继续可用 | Assisted |
| DEVICE-DESK-05 | P1 | 浏览器通知/声音 | 分别设 Default/Allow/Block/Mute 并触发测试通知 | 权限只在用户手势后申请；拒绝可降级；不循环提示 | Assisted |
| DEVICE-DESK-06 | P0 | 缓存/账号切换 | 登出 A、登录 B，使用 Back/Forward 和恢复关闭标签 | 不显示 A 的缓存数据、通知、餐厅选择或表单草稿 | Assisted |

## 8. QZ Tray 与实体打印（12）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-PRINT-01 | P0 | QZ 启动/签名 | 启动 QZ 后打开 DineFlow 并观察首次/后续连接 | 应用名称、证书和签名可信；无 `Invalid Signature` 或空签名授权弹窗 | Assisted |
| DEVICE-PRINT-02 | P0 | Test connection | 选择目标餐厅、route、printer、paper width 后检测 | 在目标时间内 Passed/Failed；结果对应当前选择而非陈旧状态 | Assisted |
| DEVICE-PRINT-03 | P0 | 厨房测试票 | 经明确授权打印编号厨房票 | 餐厅、订单号、类型、时间、商品、选项、备注、过敏原和份数正确 | Assisted |
| DEVICE-PRINT-04 | P0 | 前台收据 | 打印已付款测试订单收据 | 金额、币种、tender、找零、ABN、付款状态和退款联系方式正确 | Assisted |
| DEVICE-PRINT-05 | P1 | Unicode/长文本 | 打印中英文、重音、emoji、长名称/备注和多选项 | 可支持字符正确；不支持字符安全替代；换行不遮挡金额 | Assisted |
| DEVICE-PRINT-06 | P1 | 纸宽/切纸/蜂鸣 | 对支持的 58/80mm、切纸和声音配置各打印一次 | 宽度匹配；一单一次切纸/蜂鸣；无额外空白票 | Assisted |
| DEVICE-PRINT-07 | P0 | 断开/恢复 | 断开打印机或 QZ，产生一个测试任务，再恢复 | 明确失败/待处理；恢复后只重试一次；不丢不重 | Assisted |
| DEVICE-PRINT-08 | P0 | 缺纸/卡纸 | 在安全队列制造纸尽/卡纸并恢复 | 操作员告警清楚；任务保持可追踪；恢复后内容和顺序正确 | Manual |
| DEVICE-PRINT-09 | P0 | Mac 睡眠/唤醒 | 页面和 QZ 已连接时睡眠，期间产生测试事件，随后唤醒 | 信任/连接恢复；积压按策略处理一次；旧在线状态不误导 | Assisted |
| DEVICE-PRINT-10 | P0 | 重启 QZ/浏览器/设备 | 分别重启组件并恢复同一打印站 | 重新检测 readiness；不会沿用错误 lease/陈旧 printer；不补打已完成票 | Assisted |
| DEVICE-PRINT-11 | P0 | 双餐厅/双打印机路由 | A/B 同时产生编号厨房票和收据 | 每张只到目标餐厅/route/printer；无跨店内容泄露 | Manual |
| DEVICE-PRINT-12 | P0 | 30–50 单批量 | 经授权发送编号批次并人工清点 | 实体数量、顺序和系统任务一致；无漏打、重打、乱序或告警风暴 | Manual |

## 9. 断网、后台、崩溃和设备恢复（6）

| ID | 优先级 | 场景 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| DEVICE-REC-01 | P0 | 手机断网 | 在 Cart 保存、下单和支付回跳边界切飞行模式 | 不显示假成功；恢复后识别服务器真实结果；重试不重复 | Assisted |
| DEVICE-REC-02 | P0 | Staff 断网 | 在 Accept/Ready/Pay/Complete 前后断网 | 本地状态不越过服务器；冲突/重试可理解；最终收敛 | Assisted |
| DEVICE-REC-03 | P1 | 浏览器 crash/force close | 在 Guest/Customer/Staff 关键流程中强制关闭并重新打开 | 可恢复数据按策略保留；敏感/跨账号状态不残留 | Assisted |
| DEVICE-REC-04 | P1 | 设备重启 | 重启手机/平板/桌面并重新进入关键页面 | 会话安全恢复或要求登录；SignalR/QZ/权限状态重新确认 | Assisted |
| DEVICE-REC-05 | P1 | 长后台/过期 | 页面后台停留跨 token、Cart 或 Checkout 过期边界 | 返回时明确过期并提供恢复；无无限 spinner 或旧数据提交 | Assisted |
| DEVICE-REC-06 | P0 | 清理验证 | 完成后核对测试订单、支付、打印任务、下载、权限和设备截图 | 测试数据按计划清理；不删除非测试数据；外部副作用逐项记录 | Auto/Assisted |

## 10. 推荐执行顺序与通过门槛

1. 完成 `DEVICE-PRE-*`，只选择本轮实际可用设备。
2. 先跑不写入的布局、键盘、读屏和权限拒绝场景。
3. 再使用一次性 fixture 跑手机/平板关键流程和恢复场景。
4. 实体打印逐张授权，最后才运行 `DEVICE-PRINT-12` 批量测试。
5. 每台设备至少保存：首页/关键动作/结果或失败状态三类证据，并记录真实设备组合。

通过门槛：

- 所选 P0 用例没有未接受的 FAIL。
- 用户已确认所有实体打印、切纸、声音、触屏和辅助技术观察结果。
- QZ 连接不等于实体打印通过；模拟 viewport 不等于真实手机通过。
- 未提供的设备组合保持 `NOT RUN`；执行中被系统权限、硬件或人工手势阻止的保持 `BLOCKED`。
- 所有测试资金均为 Stripe Sandbox，且测试订单、下载和设备权限已按计划清理或记录保留原因。
