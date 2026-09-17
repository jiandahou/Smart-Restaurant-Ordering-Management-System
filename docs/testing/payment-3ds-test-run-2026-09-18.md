# Payment System 剩余项：3DS / 拒单与付款竞态 / webhook 重放 — 2026-09-18

> [上线测试缺口与接力清单](release-gap-review-2026-09-18.md) 把这几项列为 Payment System 的剩余验收，
> [非打印补测](non-printing-followup-2026-09-18.md) 明确标注 **NOT RUN：真实 Stripe Sandbox 的 3DS、拒单同时付款、回调对账**。
> 本轮在**生产 Sandbox 的专用订单**上把这三项跑掉，不动历史款项。

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-18 (ACST) |
| 环境 | Production `https://dineflow.theunknownfish.com`，`/health/ready` 200 |
| Stripe | `/api/payments/environment` 回 **mode: Test**；Connect `Ready`、charges enabled |
| 订单 | 每项新建专用订单（A$24.00），**未触碰任何历史支付** |
| 卡 | Stripe 官方 3DS 测试卡 `4000 0025 0000 3155`（需认证） |

## 1. 结论

- **11 项检查全部通过。**
- 最重要的一条：**3DS 付款成功后厨房拒单 → 12 秒内自动全额退款**，顾客的钱没有留在一个餐厅不做的订单上。
- 顾客侧文案诚实：结果页明说「餐厅无法接受此订单，已全额退款」。
- 未发现新缺陷。顺带在 3DS 银行认证页上再次看到 **#2 商户名问题**的实际影响。

## 2. 3DS 认证成功（订单 `ORD-20260917-192941`）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-3DS-01 | PASS | 提交 3DS 卡后**弹出「3D Secure 2 Test Page」认证挑战**，不是直接放行 |
| PS-3DS-02 | PASS | 点 COMPLETE 完成认证 → 回跳 `/payment/success`，显示「Payment confirmed」 |
| PS-3DS-03 | PASS | 后端 `Paid`，`amountCents 2400`，`chargeId ch_3UGh6V…`，费用拆分 `fee 114 / net 2286` |

## 3. 已付款订单被拒单（本轮核心）

清单里写的是「拒单同时付款」。精确的同秒竞态难以复现，因此改测**更确定也更危险的版本**：
钱**已经收到**之后餐厅拒单，看钱会怎样。

| 用例 | 结果 | 观察 |
|---|---|---|
| **PS-REJECT-01** | PASS | 对一笔已 `Paid` 的订单执行 Reject → 200，订单变 `Rejected` |
| **PS-REJECT-02** | PASS | **12 秒内自动全额退款**：`status=Refunded`、`refunded=2400`、`refundCount=1`，无需人工干预 |
| **PS-REJECT-03** | PASS | 顾客回到结果页 → `orderTurnedAway: true`，文案「**The restaurant could not accept this order, so it has been refunded in full.**」—— 不是含糊的「已完成」 |
| **PS-REJECT-04** | PASS | 报表里退款事件**逐条带金额**：`refund.requested / refund.created / charge.refunded / refund.updated` 全部 `amountCents=2400 aud` |

> PS-REJECT-04 是 09-16 修的 **#4（支付事件记录金额）** 第一次在真实退款场景下体现价值：
> 没有那两个字段，餐厅导出这笔七年留存的退款证据时看不到退了多少钱。

另：**未付款时拒单**也验了——厨房可以拒，随后 confirm 返回 409「The Stripe Checkout session expired without payment.」，会话被正确作废。

## 4. 3DS 认证失败（订单 `ORD-20260917-207461`）

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-3DS-FAIL-00 | PASS | 在挑战页点 FAIL → 停留在支付页，显示「We are unable to authenticate your payment method. Please choose a different payment method and try again.」——可行动，且**不泄露风控细节** |
| PS-3DS-FAIL-01 | PASS | 后端 `status=Failed`，**无 chargeId、无 paidAt** |
| PS-3DS-FAIL-02 | PASS | 订单**没有被当成已付** |
| PS-3DS-FAIL-03 | PASS | 同一订单可以重新发起支付 → 200，**路径可恢复** |

## 5. Webhook 重放

| 用例 | 结果 | 观察 |
|---|---|---|
| PS-WH-REPLAY | PASS | 同一事件 id 连发 3 次（无有效签名）→ 全部 400；支付事件总数 **109 → 109**，一条都没记进去 |

> 带**有效签名**的重放幂等性本轮仍未覆盖——那需要能用 Stripe CLI 或 webhook secret 构造签名。
> 本轮只证明了无效签名不会写入，**不等于**已验证重复事件的幂等处理。

## 6. 顺带确认的既有问题

3DS 银行认证页上写的是「This is a test 3D Secure 2 authentication for a transaction with **CENTRAL MARKET TABLE**」。
这是清单里 **#2 商户名不一致**的又一处顾客可见位置——不只是卡账单和 Checkout 页，
连**银行的身份验证页**都显示错误的商户名，而这正是顾客最会停下来确认「我在付给谁」的一屏。

## 7. 清单回填

| 清单项 | 此前 | 现在 |
|---|---|---|
| 3DS 成功/失败/关闭 | NOT RUN | 🟡 **成功与失败已跑**；「关闭/取消挑战」未单独跑 |
| 拒单同时付款 | NOT RUN | 🟢 **已跑**（已付款后拒单 → 自动全额退款） |
| webhook 延迟/重放与浏览器回跳 | NOT RUN | 🟡 **回跳与无效签名重放已跑**；有效签名重放、延迟投递未跑 |
| 启用的异步方式如 Klarna | NOT RUN | 🔴 仍未跑 |

## 8. 仍未覆盖

- **有效签名的 webhook 重放与乱序**：需要 Stripe CLI 或 webhook secret。
- **Klarna 异步路径**：`checkout.session.async_payment_succeeded/failed` 零覆盖；清单建议要么正式环境关掉要么补测。
- **3DS 挑战中途取消**（点 CANCEL 而非 FAIL）。
- **真实 live 低金额支付与退款**：需另行授权，Sandbox 通过不替代 live。
