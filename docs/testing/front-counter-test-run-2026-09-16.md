# front-counter 生产测试run — 2026-09-16

> 2026-09-15 总报告里 `front-counter(182)` 标为 🔴 未跑。本轮跑完其中可对活体系统验证的部分。
> 接力入口：[production-test-report-2026-09-15.md](production-test-report-2026-09-15.md)

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST) |
| 环境 | Production `https://dineflow.theunknownfish.com`，`main` @ `6ed7440` |
| 账号 | Staff A/B、Admin A、Owner A、Customer A（seed，密码 `DineFlow123!`） |
| 餐厅/桌台 | 餐厅 A；桌台 T3 / T4（经 QR token 真实落座下单） |

## 1. 结论

- **60 项断言，59 PASS / 1 FAIL。**
- 权限、租户隔离、冲正、桌台结算、队列口径**全绿**；金额、找零、Session 开闭、并发边界都站得住。
- **1 个确认缺陷**：现金收款金额**没有上限**，前后端都只校验「不少于应收」。见第 4 节。

## 2. 分组结果

### 2.1 角色与租户隔离（13/13 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| FC-ROLE-01 | PASS | 匿名 → 401 |
| FC-ROLE-03 | PASS | **Customer token 调前台 API → 403**，不能当 Staff 凭证 |
| FC-ROLE-08 | PASS | Staff / Admin / Owner 三种角色打开前台，返回的订单**只含餐厅 A** |
| FC-ROLE-05 | PASS | Staff A 搜「Spice Garden」→ 0 命中 |
| FC-ROLE-05b | PASS | Staff A 强行传 `restaurantId=B` → **403**（不是静默降级成 A） |
| FC-ROLE-06a/b/c | PASS | Staff B 对 A 的订单调 record-payment / settle-complete / complete → 全 404 |
| FC-ROLE-06d | PASS | **三次越权探测后，A 的订单仍是 Ready/Unpaid，一个字节没动** |
| FC-TABLE-20a/b | PASS | 随机 table / session id → 404，不泄露桌号或金额 |

### 2.2 收款、完成与 tender（9/10 PASS，1 FAIL 见第 4 节）

| 用例 | 结果 | 观察 |
|---|---|---|
| FC-ORDER-01 | PASS | 非 Ready 单 Record payment → 只有 payment 变 Paid，**订单仍是 Accepted** |
| FC-ORDER-02 | PASS | record-payment + settle-complete → Completed/Paid，找零正确 |
| FC-ORDER-07 | PASS | 非 Ready 单直接 complete → 409「Only orders marked Ready…」**不能跳过厨房** |
| FC-ORDER-08b/c | PASS | 对已完成订单重复收款/完成 → 409 |
| FC-TENDER-02 | PASS | Card → received = 应收，change = 0 |
| FC-TENDER-03/04 | PASS | 现金刚好 → change 0；现金 50 付 24 → change **26.00** |
| FC-TENDER-05 | PASS | 现金 23.99 / 0 / -10 / 不传 → **全部 400**，一分钱都收不到 |
| FC-TENDER-06 | PASS | `abc` `NaN` `Infinity` `1e999` `1.2.3` `""` `24,00` → 全 4xx，**无 500** |
| FC-TENDER-09 | PASS | tender 传 `Bitcoin` / `""` / `Online` / SQL 片段 / 不传 → 全拒，**不会静默当成 Card** |
| **FC-TENDER-08** | **FAIL** | **现金金额无上限** —— 见第 4 节 |
| FC-TENDER-14 | PASS | 重放 record-payment → 409，只存在一笔有效柜台收入 |

### 2.3 Void 与 Offline Refund（15/15 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| FC-REV-04 | PASS | 理由为空/纯空格 → 拒绝（理由是唯一可审计的控制点，挡住了） |
| FC-REV-09 | PASS | Staff B 冲正 A 的收款 → 404 |
| FC-REV-05 | PASS | 干净柜台收款 Void → 200，订单退回 **Ready/Unpaid**，未被误关单 |
| FC-REV-05b | PASS | Void 之后可以重新收款 → 200 |
| FC-REV-07a | PASS | 重放 Void → 409「can no longer be voided. Record an offline refund instead」 |
| FC-REV-06a/b | PASS | 部分线下退款 $10 → `PartiallyRefunded`，refunded=1000 / refundable=1400 |
| **FC-REV-02** | PASS | **已有退款的收款不能再 Void** → 409，历史抹不掉 |
| FC-REV-06c | PASS | `amountCents` 传 null 退余额 → `Refunded`，refundable=0 |
| FC-REV-07b | PASS | 全退后再退 → 409 |
| FC-REV-06d | PASS | 退款金额 0 / 负数 / 1e12 → **全拒**（对比：现金收款没有这层上限） |
| **FC-REV-03** | PASS | **柜台 Void 打在 Stripe 支付上 → 409**，线上钱走不了线下冲正 |

### 2.4 桌台、Session 与整桌结算（10/10 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| FC-TABLE-02 | PASS | T3 两笔堂食 → 同一 session，orders=2 / items=3 / due=72.00 |
| **FC-TABLE-10** | PASS | **任一单未 Ready → 整桌 409**，「Every active table order must be marked Ready…」 |
| FC-TABLE-10b | PASS | **拒绝后桌台原子不变** —— session 与订单数都没动 |
| FC-TABLE-14a | PASS | 整桌现金差 1 分 → 400「must be at least 72.00」 |
| FC-TABLE-12 | PASS | 应收 72、收 92 → change **20.00** |
| FC-TABLE-12b | PASS | 结算后两单**同时**变 Completed/Paid，无半桌状态 |
| FC-TABLE-18 | PASS | 最后一单完成 → session 关闭，activeOrders 归 0 |
| FC-TABLE-16 | PASS | 重放整桌结算 → 404（session 已关） |
| FC-TABLE-19 | PASS | **同一张桌重新落座 → 开新 session**，旧账单不混入应收 |
| FC-TABLE-17 | PASS | 两单只完成一单 → session 仍 Open，activeOrders=1 |

### 2.5 队列口径与线上/线下边界（13/13 PASS）

| 用例 | 结果 | 观察 |
|---|---|---|
| FC-ORDER-06pre | PASS | **未付的线上单进不了厨房流程**（409），所以「Ready + 线上未付」这个状态**根本不可达** |
| FC-ORDER-06 | PASS | 对线上未付单直接柜台收现 → 409，**绕不过在线支付** |
| FC-SWITCH-01/02/03 | PASS | 走**显式**的 pay-at-counter 切换后才能收现 → 200，订单转 Paid |
| **FC-SWITCH-04** | PASS | **Stripe session 还活着时禁止切换** → 409「cannot be changed while an online payment is pending」（防重复收款） |
| FC-QUEUE-05a/b | PASS | 全额退款单 → 「Fully refunded orders cannot be charged again / cannot be completed」 |
| FC-QUEUE-07 | PASS | 42 条活跃单里**没有一条** Completed/Cancelled/Rejected |
| FC-LIST-05 | PASS | `%` `_` `'` `" OR 1=1--` emoji 300 字符 → 无 500、无异常回显 |
| FC-LIST-10 | PASS | pageSize 0/1/24/501/99999/-5 → 400；25/500 → 200（边界与契约一致） |

## 3. 未覆盖（下一棒）

需要浏览器逐页或双会话，本轮未跑：

- **第 6 节 页面加载与实时恢复（12）**：轮询 15s、SignalR 300ms 合并刷新、断线重连、乱序响应、后台休眠唤醒。
- **第 7 节 搜索与营业日分组**剩余部分：debounce、Load more、business date 的 Today/Yesterday 标题、重复取餐号。
- **第 9 节 订单卡片内容（12）**：选项/备注/安全备注/退款行的展示。
- **第 14 节 收据与打印路由（16）**：Browser/QZ、合并收据、打印机实测。
- **第 15 节 无障碍与响应式（14）**。
- **并发类 Assisted**：FC-ORDER-09、FC-REV-08、FC-TABLE-16 的双 Staff 同时提交（后端已有并发测试覆盖，但未在生产双会话实跑）。

## 4. 发现的问题

### #1 现金收款金额没有上限（FC-TENDER-08，FC-TABLE-14 同样路径）

**确认方式**：对一笔应收 A$24.00 的订单

| 输入 | 结果 |
|---|---|
| 现金 `5000.00`（少打一位的典型笔误） | **200**，`changeDue = 4976.00` |
| 现金 `1000000000000000` | **200**，`changeDue = 999999999999976.00` |
| 整桌结算 现金 `999999999`（应收 24.00） | **200**，`changeDue = 999999975.00` |

**两层都只校验下限**：

- 后端 [StaffFrontCounterController.cs:1115](../../backend/dineflow/DineFlow.Api/Controllers/StaffFrontCounterController.cs#L1115)
  `ValidateTender` 只有 `amountReceived.Value < amountDue` 一个判断，之后直接
  `ChangeDue = amountReceived - amountDue`。
- 前端 [FrontCounterPage.tsx:974](../../frontend/dineflow-web/src/pages/FrontCounterPage.tsx#L974)
  `cashEntryValid` 同样只有 `parsedCashReceived >= pendingAmountDue`；`<Input>` 只设了
  `min={pendingAmountDue}`，**没有 `max`**；
  [cashEntryNotice.ts](../../frontend/dineflow-web/src/lib/cashEntryNotice.ts) 也只对「少于应收」提示。

**为什么要紧**：`changeDue` 就是收银员照着找钱的数字。少打一位小数点——$50 打成 $500——
对话框立刻显示应找 $476.00 并且可以直接确认，没有任何二次确认。这是收银台最常见的手滑，
而系统里其他每一个金额入口（退款金额、整桌应收）都有上限，唯独现金收款没有。

**影响边界（已核实）**：账目本身**没有被污染** —— Payment 的 `amountCents` 始终等于账单金额
（1e15 那笔记的仍是 `2400`）。受影响的是返回给收银台并打在小票上的 `amountReceived` / `changeDue`。
所以是**操作风险**，不是账实不符。

**建议修法**：在 `ValidateTender` 里对现金加一个上限——比如不得超过应收的若干倍或一个绝对封顶，
超过则 400；前端同步加 `max` 与一句「金额远高于应收，请确认」的二次确认。两处都要改，
因为前端只是提示，真正把钱记下来的是后端。

### #2 餐厅主数据缺失，会印到小票上（延续 09-16 payment 报告问题 #2）

前台的桌台/收据接口回的是：

```
restaurantLegalBusinessName: ""
restaurantAbn:               null
restaurantRefundContactEmail:""
restaurantGstRegistered:     false
```

`restaurantAddress` 和 `restaurantPhone` 有值。合并收据与单订单收据会带着空的法定名称、
空 ABN 和**空退款联系邮箱**打出去。属 seed 数据缺口，不是代码缺陷，但上线前必须在
Admin → Restaurants 补齐。

## 5. 覆盖矩阵更新

| 模块 | 用例数 | 09-15 | 09-16 |
|---|---:|---|---|
| **front-counter** | 182 | 🔴 未跑 | 🟡 **API 面已深跑**（60 断言，59 PASS / 1 FAIL）；浏览器/打印/无障碍待跑 |

## 6. 本轮产生的测试数据（未清理）

在餐厅 A 又新增了约 20 笔测试订单与若干柜台收款/退款记录，桌台 T3/T4 上有开放 session。
与 payment-system 那轮的 23 笔合并计算，生产库今日测试数据规模见两份报告，**均未清理**，
由执行者决定处理方式。
