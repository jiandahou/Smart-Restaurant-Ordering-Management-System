# 退款对账 / 会话吊销 / 邮件降级 — 2026-09-20

三项接力：生产 Sandbox 上真跑一次部分退款的四端对账、改密后 refresh token 是否失效、邮件发不出去会不会挡住下单。

| 项 | 环境 | 结果 |
|---|---|---|
| 1. Admin Payments 退款四端对账 | 生产 Sandbox（真 Stripe） | 15/15 通过，发现并修复 1 个缺陷 |
| 2. 改密 / 停用后 refresh token 吊销 | 生产 Sandbox | 10/10 通过 |
| 3. 邮件发送失败不挡下单 | 本地栈（故意注入无效 key） | 10/10 通过 |

---

## 1. 退款四端对账（生产 Sandbox）

09-18 那次是用**模拟 Stripe** 跑的，生产上没真跑过。这次真付了一笔再真退。

为了让"加料单独退"这条有意义，专门造了一道带加价选项的菜：主菜 A$20.00 + 加料 "Truffle" A$5.00。
订单 `ORD-20260920-186651`，合计 **A$25.00**，浏览器里用测试卡 4242 付掉。

付款落库确认：`status: Paid, amountCents: 2500, providerChargeId: ch_3UHgaHLSOivWr71J15gJDDmG,
stripeFee 118, net 2382, refundable 2500`。

然后**只退那 5 块钱的加料**，四端各看一次。

| 用例 | 结果 |
|---|---|
| R4-01 顾客只针对加料发起退款申请 | 201，金额 **500** |
| R4-02 进到管理端队列 | 1 条，Pending |
| R4-03 按加料的 500 计价，不是整行的 2500 | 500 |
| R4-04 另一家餐厅的管理员在自己队列里看不到 | 看不到 |
| R4-05 店员点批准 | 403 |
| R4-06 另一家餐厅的管理员点批准 | 403 |
| R4-07 本餐厅管理员批准 | 200 |
| R4-08 Stripe 侧真的动了 | `PartiallyRefunded`，已退 500，剩余可退 2000 |
| R4-09 同一条批准两次 | 409「Only pending refund requests can be approved.」，仍是 500 |
| R4-10 顾客端看得到 | `paymentStatus=PartiallyRefunded`，该行已退 500，加料已退 500 / 剩 0 |
| R4-11 顾客看得到处理结果 | `Approved`，申请 500，实退 500 |
| R4-12 整行被标成按件退 | `refundGranularity: ByItsParts`，加料剩余可退 0 |
| R4-13 再退同一个加料 | 400「"Truffle" has already been refunded.」 |
| R4-14 退完加料再退整行 | 400「Extras … have already been refunded individually, so it can only be refunded …」 |
| R4-15 报表事件带上金额 | 见下 |

R4-15 一开始被我判成不通过，**判错的是我不是产品**。事件流是：

```
refund.updated 500 · charge.refunded 2500 · refund.created 500 · refund.requested 500
checkout.session.completed 2500 · payment_intent.succeeded 2500 · checkout_session.created 2500
```

我原本认定 `charge.refunded` 该带 500。不对：这一列记的是**该事件所指的那个 Stripe 对象的金额**。
一笔部分退款之后，charge 的 `amount` 仍然是 2500（退掉的部分在 `amount_refunded` 里），所以
2500 是对的，而且和同样带 2500 的 `payment_intent.succeeded`、`checkout.session.completed` 是一致的。

> **读表的人要注意**：不能按"事件名里带 refund"去汇总退款额，`charge.refunded` 会被算进来。
> 要汇总退款只能筛 `refund.*`。这是读法问题，不是缺陷。

### 修掉的缺陷：只退加料时不填数量 → 500

跑第一遍时 R4-01 返回 **500**。查下来是真问题：

- 请求体里每个选项都带 `quantity`。**整行**那条分支会校验它，填 0 直接干净地 400。
- **加料**那条分支从头到尾没看过 `quantity`——加料的价钱是按它自己的 contribution 算的，
  跟这个数无关，所以后面的金额闸门也放行了。
- 于是带着 `Quantity = 0` 落库，撞上 check 约束 `CK_PaymentRefundRequestItems_Quantity ("Quantity" > 0)`，
  PostgreSQL 抛 23514，顾客那头收到的是 **500**。

同一个字段漏填，点菜那行给 400、上面的松露给 500。

**影响面有限**：DineFlow 自己的网页端在 [MyOrdersPage.tsx:583](../../frontend/dineflow-web/src/pages/MyOrdersPage.tsx#L583)
里写死了 `quantity: orderItemOptionId ? 1 : …`，加料永远送 1，所以从自家 UI 走不到。
但契约本身是允许省略的（`AmountCents` 的注释就明说"Null keeps older clients working"），
别的调用方漏填就会踩到，而且这是个顾客侧端点。

**已修**：在加料分支补上和整行分支同样的 `RefundRequestItemPolicy.IsValidQuantity` 校验，
改成 400 并说明允许范围。

**回归测试** `DineFlow.Tests/ModifierRefundQuantityTests.cs`，直接驱动 `ValidateModifierSelection`。
把修复退掉验证过：5 条里 4 条失败；补回修复 5/5 通过。全量 1131 passed / 0 failed。

---

## 2. 改密 / 停用后 refresh token 吊销（生产 Sandbox）

10/10 通过。

| 用例 | 结果 |
|---|---|
| 正常轮换 | 换出新 token |
| 旧 refresh token 再用一次 | 409「This session was refreshed in another tab」 |
| 管理员改了某人的密码 → 那人的旧 refresh | 401「You have been signed out. Please log in again.」 |
| 本人自助改密 → 旧 refresh | 409 |
| 账号被停用 → refresh | 失效 |
| 伪造 / 空 token | 401 |

轮换是一次性的，security stamp 一变旧票即死，两条路径都作数。

---

## 3. 邮件发不出去不挡下单（本地栈）

不能在生产上故意打坏邮件，所以在本地栈做：把 `.env` 里的 `RESEND_API_KEY` 换成
`re_invalid_key_for_email_failure_test`（原值备份在 scratchpad 的 `env-backup`），重启后端，
跑一条完整链路。

下单 → 厨房流转 → 前台收款 → 完成 → 部分退款，**全部成功**，10/10。退款是真落的
（`PartiallyRefunded`，500 分），payment event 也照常写了。也就是说发信失败只停在 outbox，
不会把调用方的事务带下水。

`.env` **已还原并核对**：无效 key 出现次数 0，后端 health 正常。

---

## 顺带记一句

契约上容易踩的两处（我都踩了）：

- 退款申请必须带 `items`，光给金额会被 400「Select at least one item to refund」。
- `items[].quantity` 是必填的；加料那条以前漏填会 500，现已修成 400。
- 顾客端订单里选项的字段名是 `optionNameSnapshot` / `priceAdjustmentSnapshot`，
  不是 `optionName` / `priceAdjustment`。按后者读会全是 null，看着像后端没返回。
