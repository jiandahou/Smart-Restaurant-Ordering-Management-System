# 打印机接力验收 — 2026-09-20

环境：本地 Chrome `http://localhost:5173/staff/orders`，Owner；分支 `jianda-payment-test-2026-09-16` @ `9d342e1`，初始 5 个脏路径保留。运行中应用版本未对齐验证。

## 第一步：连接与物理状态

- QZ Tray connected，版本 2.2.6。
- 餐厅 The DineFlow Kitchen；Kitchen / QZ Tray / System printer / star / 80mm / UTF-8。
- 自动打印开启，自动接单开启，切纸开启，蜂鸣关闭；本轮未修改。
- 页面连接项显示 Passed，但物理检测显示 `Printer did not respond` / `"star" reports PAUSED`。
- 已执行 Check the printer now 和 Refresh printers，暂停提示仍在。不能把连接 Passed 算作物理就绪。
- OS 队列 CLI 查询未成功，未核实积压任务数；没有清队列、恢复队列或发送测试票。
- `PRINT-01` / `DEVICE-PRINT-02`：**BLOCKED**，等待用户确认目标打印机、纸张和 OS 队列状态。当前仅 QZ 连接观察成功，完整连接验收未通过。
- `PRINT-02` 厨房票、`PRINT-03` 收据、`PRINT-04` 断连恢复：**NOT RUN**，按顺序逐张接力。
- 物理结果：尚未取得用户观察，不标 PASS。

证据：`test-results/20260920-171816/evidence/001-kitchen-paused.png`。Chrome 接力页已保留。

用户下一步：确认 star 是否为当前测试机、纸宽是否 80mm；打开该机系统打印队列查看是否暂停和是否有旧任务。若有旧任务先报告数量，不清空、不直接恢复以免批量出旧票。空队列可由用户恢复后通知 Agent，再发一张测试票。

## 接力更新：恢复后首次测试

- 用户截图确认旧乱码任务为 Untitled / 4 pages / 1 copy；随后用户报告已恢复。
- 重新读取页面：`Printer responded` / `"star" is ready`，QZ 2.2.6 connected。
- Agent 点击 **一次** Kitchen 的 Print test ticket；未再次点击或重试。之后页面未出现新的可见成功/失败提示，Last ticket 字段仍为 not since this page was opened。
- 厨房实体测试保持 **BLOCKED（等待人工输出确认）**：不能仅凭点击或 ready 当作出票成功。等待用户报告是否出纸、张数、内容和切纸，之后再决定是否检查 QZ 授权或任务记录。

## 实体诊断票观察

- 用户提供实体照片，票号 `TEST-001`，标题 `KITCHEN TICKET / KITCHEN PRINTER DIAGNOSTICS`，创建及打印时间均为 2026-09-20 05:25 PM。
- 英文、数字及 ASCII 符号清晰可读；未见此前连续乱码。`If this line is readable, encoding is correct.` 正常打印。
- 测试中的不支持字符被明确替换为 `[UNSUPPORTED TEXT - SEE SCREEN]`，没有把原始脚本/HTML 或控制字符直接送往打印机；记录为安全降级，不代表中文/Emoji 原样打印通过。
- 80mm 内容在照片可见范围内未横向截断；较长内容正常换行。照片未覆盖完整底边，无法判断切纸及尾部空白。
- Print tasks 面板仅显示 09-12 的历史订单任务，均为 Completed attempt 1；本次诊断票未显示为订单打印任务，也未发现它被自动重复排队。
- 用户确认实体诊断票只出一张并自动切纸。`PRINT-01`、`DEVICE-PRINT-01/02`、本轮 80mm 自动切纸检查：**PASS**。蜂鸣未启用，不在本次结果中。
- `DEVICE-PRINT-03`：仍 **NOT RUN**。这是一张诊断票，不含真实订单的商品、选项、备注、过敏原和份数，不能冒充厨房订单票通过。

实体照片：`test-results/20260920-171816/evidence/002-kitchen-diagnostic-physical.jpg`。

## 真实订单厨房票：实体内容已确认

- Guest / Takeaway 创建并仅提交一次 Pay at counter 订单 `ORD-20260920-579220`，总额 A$17.11。
- 预期票据内容：Chicken Wings ×1；Sauce = Smoky BBQ（+A$0.74）；Heat level = Extra hot（+A$0.37）；商品备注 `PRINT-0920-REAL-01 kitchen ticket check; No onion; Peanut allergy`；整单备注 `PRINT-0920-REAL-01 order note`。
- Staff 页面同时显示新订单提示和 `Kitchen ticket sent — ORD-20260920-579220 via QZ Tray`。
- Print tasks 仅出现一条该订单任务：`Completed attempt 1`，打印机 `star`，2026-09-20 05:44 PM；Agent 未点击重试、手工打印或再次提交。
- 用户提供实体照片：票面编号 `001`，Takeaway，餐厅 The DineFlow Kitchen；完整订单号 `ORD-20260920-579220`，状态 Accepted，创建/打印时间均为 05:44 PM，商品数 1。
- 实体票正确显示 `1X Chicken Wings`、Heat level = Extra hot、Sauce = `Smoky BBQ [MAY CONTAIN MUSTARD]`、商品备注中的 No onion / Peanut allergy，以及整单备注。长备注正常换行，未见乱码、横向截断或原始脚本内容。
- 厨房票按职责未打印售价或总额；金额 A$17.11 已在顾客 Checkout 与系统订单中核对，不把厨房票没有金额记为缺陷。
- `DEVICE-PRINT-03` 的餐厅、订单号、类型、时间、商品、选项、备注、过敏原和份数：**PASS**。`PRINT-02` 的实体内容部分：**PASS**。
- 用户补充确认该真实订单票也只出一张并自动切纸。系统侧单次提交/单次传输、实体无重复及一次自动切纸均为 **PASS**；`PRINT-02` 与 `DEVICE-PRINT-03`：**PASS**。

实体照片：`test-results/20260920-171816/evidence/003-kitchen-real-order-physical.jpg`。

## 前台收据：已打印，等待实体确认

- Front counter 路由已核对：QZ Tray / System printer / `star` / 80mm / UTF-8；连接 Passed、设备 ready、切纸开启、蜂鸣关闭。
- 同一测试订单已按合法流程从 Accepted → Preparing → Ready；前台显示应收 A$17.11。
- 已选择 Cash，准备记录现金 A$20.00，页面正确计算找零 A$2.89。
- 用户明确允许后，Agent 仅点击一次 Confirm：订单记录为 Cash 已付款并 Completed。Recent counter payments 显示票号 `001`、A$17.11、Order status = Completed、Payment status = Paid。
- 完成后的打印确认框仅点击一次 Print receipt；未点击 Reprint last receipt。Front counter 打印配置显示 `Last ticket actually printed: 5:52:57 PM`，打印机仍为 `star` / ready。
- 系统侧金额、tender、找零、状态和单次打印触发：**PASS**。实体收据内容、ABN、退款联系方式、张数和切纸：**BLOCKED（等待用户观察）**；`PRINT-03 / DEVICE-PRINT-04` 尚不能标 PASS。

## 前台收据：实体照片结果

- 用户提供票号 `001` 的实体收据照片。票面正确显示 The DineFlow Kitchen、地址、电话、`ORD-20260920-579220`、Takeaway、Completed、Paid、Cash、Received A$20.00、Change A$2.89、商品及选项拆价、备注、Total A$17.11、Amount due A$0.00。
- 80mm 排版清晰；长备注正常换行，金额列未被挤出；未见乱码、截断或原始脚本内容。
- 票面没有 ABN，也没有 `Refund enquiries` 或明确退款联系方式；页面仅打印普通联系电话，不能证明该号码是退款渠道。`PRINT-03 / DEVICE-PRINT-04` 对 ABN 与退款联系方式的明确预期未满足：**FAIL**。
- 代码检查显示收据构建器和 ESC/POS 模板会在 `restaurantAbn` / `restaurantRefundContactEmail` 非空时打印对应字段，并已有单元测试；本次缺失来自 The DineFlow Kitchen 的餐厅身份配置/种子数据为空，而不是这张票的换行或编码丢失。
- 当前发布风险是：已有或迁移来的 AU 餐厅如果未补齐法定身份，系统仍可收款并打印缺少 ABN/退款联系信息的收据。上线前应对真实餐厅配置 ABN、legal business name、GST 状态和 refund contact，并重新打印验收；最好增加发布/收款 readiness gate 或迁移审计。
- 用户补充确认实体收据只出一张、自动切纸且无额外空白票：张数与切纸 **PASS**。已经确认的 ABN/退款联系信息缺失不受影响，`PRINT-03 / DEVICE-PRINT-04` 总体仍为 **FAIL**，需补齐餐厅法定身份后重打。

实体照片：`test-results/20260920-171816/evidence/004-front-counter-receipt-physical.jpg`。
