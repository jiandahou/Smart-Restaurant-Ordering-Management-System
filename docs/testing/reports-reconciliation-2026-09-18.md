# Admin Reports 逐分对账 — 2026-09-18

> [上线测试缺口与接力清单](release-gap-review-2026-09-18.md) 给 Admin Reports 留的剩余验收是
> 「**支付与部分退款后的汇总/CSV 逐分对账；日期/时区边界**」。本轮跑掉这两项。
> 纯只读 + 两笔专用订单，不动生产配置、不碰历史款项。

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-18 (ACST) |
| 环境 | Production `https://dineflow.theunknownfish.com` |
| 对账素材 | 当天 [3DS 轮](payment-3ds-test-run-2026-09-18.md)产生的**真实全额退款**，加一笔新建的柜台**部分退款** |

## 1. 结论

- **12 项检查全部通过。**
- 金额在**三处一致**：payments 表、报表 API、CSV 导出。
- **部分退款不会被读成全额退款**——收款额与退款额各记各的数。
- 日期窗口不漏不多，时间戳是显式 UTC。

## 2. 金额对账（6/6）

| 用例 | 结果 | 观察 |
|---|---|---|
| REC-01 | PASS | CSV 里出现的 5 笔支付，逐笔与 payments 表的 `amountCents` 交叉核对，**无一不符** |
| **REC-02** | PASS | 当天那笔被拒单退款的订单：payments 表 `Refunded`，退 2400 / 共 2400 |
| **REC-03** | PASS | 同一订单的 **7 类事件全部带 2400**：`checkout_session.created`、`checkout.session.completed`、`payment_intent.succeeded`、`refund.requested`、`refund.created`、`charge.refunded`、`refund.updated` |
| **REC-04** | PASS | 新建柜台单收款 2400 后**部分退款 900** → `PartiallyRefunded`，退 900 / 可退 1500 |
| **REC-05** | PASS | CSV 把两者**分开记**：`counter.recorded = 2400`、`counter.refunded = 900`。部分退款读不成全额 |
| REC-06 | PASS | activity summary 可读，带时区 `Australia/Adelaide` 与当日收款按币种分组 |

> REC-03 与 REC-05 合起来是 09-16 修的 **#4** 的完整价值证明：
> 修之前，这些事件行**一个金额都没有**，餐厅导出七年留存的支付证据时看不到任何钱数。

## 3. 日期与时区边界（3/3）

| 用例 | 结果 | 观察 |
|---|---|---|
| REC-07 | PASS | 当日窗口 16 行，**0 行落在边界之外** |
| REC-08 | PASS | 2030 年起的窗口 → 0 行 |
| REC-09 | PASS | `from` 晚于 `to` → 200 且 0 行（空集而非报错，也没有反向返回全量） |
| REC-11 | PASS | 导出时间戳形如 `2026-09-17T15:28:52.6635840Z`，**显式 UTC**，不拿本地时间冒充 |

## 4. 导出完整性（1/1）

| 用例 | 结果 | 观察 |
|---|---|---|
| REC-10 | PASS | 同一日期窗口：列表 `totalItems=16`，CSV **16 行数据**。导的是完整匹配集，不是当前页 |

## 5. 一处路径区分（不是缺陷）

`REC-04` 第一次报 FAIL：部分退款没生效，支付仍是 `Paid`。核查后是我走错了接口——

```
POST /api/admin/orders/{id}/refund   → 409 "Only online payments can be refunded through Stripe."
POST /api/staff/front-counter/payments/{id}/offline-refund → 200
```

柜台收款与线上支付走**两条不同的退款路径**，这是明确的设计区分：柜台的钱不能经 Stripe 退。
换用正确路径后结果正常。**产品没有问题，是我的调用错了。**

> 这是同类错误的第五次（前四次：guest 查询用空列表表示无权、改价缺版本号、写餐厅配置用错字段名、
> 并发测试测了绝对值）。本轮的形态是**用错了端点**而不是用错了字段。
> 教训不变：**先确认前置操作真的做成了，再解读断言。**

## 6. 清单回填

| 清单项 | 此前 | 现在 |
|---|---|---|
| 支付与部分退款后的汇总/CSV 逐分对账 | 剩余验收 | 🟢 **已跑**（12/12） |
| 日期/时区边界 | 剩余验收 | 🟡 **UTC 窗口与边界已跑**；跨午夜的**餐厅本地营业日**归属未跑 |
| 修复版本与正式部署一致 | 剩余验收 | 🟢 已确认：生产跑的是 `6a5260f`，#4/#5 的行为在线上实测生效 |

## 7. 仍未覆盖

- **跨午夜营业日归属**：报表按 UTC 切窗口，餐厅的「营业日」可能跨午夜（09-12 有过一个
  「Honor special dates after overnight trading」的修复）。汇总口径与营业日口径是否一致，本轮没验。
- **5000 行截断告警**：当前最大标签仍远不到上限。
- **多币种汇总**：summary 已按币种分组，但只有 AUD 一种数据。
