# cart 深跑 — 2026-09-16（合并后）

> cart(294) 是最大的模块，此前只有代表性抽测。并行会话当天已用本地随机测试覆盖了**并发、幂等、库存竞争、数量与备注边界、Unicode**（见 [local-random-test-report-2026-09-16.md](local-random-test-report-2026-09-16.md)）。
> 本轮**刻意不重复那些**，改打他们没碰的面：**服务端价格完整性、跨餐厅注入、菜单中途变化的重校验、订单类型与凭证规则**。
> 接力入口：[production-test-report-2026-09-16.md](production-test-report-2026-09-16.md)

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST)，`main` @ `6a5260f`（8 个修复已部署） |
| 环境 | Production `https://dineflow.theunknownfish.com` |
| 夹具 | 每轮用 admin 接口**新建专用菜品**，跑完删除——不依赖 seed 菜品当时剩多少库存 |

## 1. 结论

- **29 项检查全部通过**（价格与访问 16 · 菜单重校验 10 · 改价复测 3）。
- **价格完整性是这一轮最硬的一面**：客户端传什么金额，服务端一概不看。
- 未发现新缺陷。两条一度标红的用例经查是**我的请求没生效**，不是产品问题，见第 5 节。

## 2. 价格完整性与访问控制（16/16）

| 用例 | 结果 | 观察 |
|---|---|---|
| CART-OPT-01 | PASS | 3 × 12.35 → unit 12.35 / line 37.05，服务端自己算 |
| **CART-OPT-22a** | PASS | 同一请求里塞 `unitPrice`、`price`、`lineTotal`、`priceAdjustment` 四个字段想把 12.35 压成 **0.01** → **服务端一个都不看**，照菜单价 12.35 收 |
| CART-OPT-22b/c | PASS | 数量 -2 / 0 → 400「must be between 1 and 100」 |
| CART-OPT-02 | PASS | 跳过必选组 → 400「'Dip' requires at least 1 choice(s)」 |
| **CART-OPT-07** | PASS | 借**别的菜品**的 optionId、以及凭空编造的 UUID → **都是 400**，借外部 ID 改价走不通 |
| CART-OPT-06 | PASS | 同一 optionId 重复 6 次 → 400「allows at most 1 per item」 |
| **CART-XREST** | PASS | 把**餐厅 B 的菜**加进餐厅 A 的购物车 → 409「belongs to another restaurant」 |
| CART-OPT-10 | PASS | 100 × 12.35 = 1235.00，无浮点尾差 |
| CART-OPT-21a/b | PASS | 行合计 53.20 = 购物车总额 53.20 = **下单后订单总额 53.20**，三处逐分一致 |
| **CART-TOKEN** | PASS | 不带凭证 / 拿别的购物车的凭证 / 垃圾凭证读购物车 → **全部 401** |
| **CART-TOKEN-W** | PASS | 同样三种情况**写**购物车 → 全部 401 |
| CART-TYPE-01 | PASS | join 不带 orderType → 400 `order_type_required`（不替顾客猜堂食还是外带） |
| CART-TYPE-02 | PASS | orderType 传 `Delivery` → 400 |
| CART-TYPE-03 | PASS | 同时传 restaurantId 和 tableQrToken → 400 |

## 3. 菜单中途变化的重校验（10/10）

购物车打开着，后台改菜单，再看购物车与结账的反应。

| 用例 | 结果 | 观察 |
|---|---|---|
| **CART-OPT-12** | PASS | 管理端把单价 10.00 改成 25.00 → **打开着的购物车总额立刻从 20.00 变成 50.00** |
| **CART-OPT-14** | PASS | 随即结账 → **按 50.00 收**。静默按 20.00 收才是缺陷 |
| CART-STOCK-01 | PASS | 持有期间菜品售罄 → 结账 409「This item has sold out.」，点名是哪道菜 |
| CART-AVAIL-01 | PASS | 持有期间菜品下架 → 结账 409「The restaurant has taken this item off the menu」 |
| CART-AVAIL-02 | PASS | 已下架的菜再加进购物车 → 409 |
| **CART-DEL-01** | PASS | 有人正拿着它时删除菜品 → **409** —— 今天修的 #13，从顾客这一侧看到的样子 |
| **CART-DEL-02** | PASS | 而**顾客仍然能把手里这单结掉**（200）。删除被挡住，正是为了不把菜从顾客手里抽走 |
| CART-LEGAL | PASS | 结账不带确认 / 带 2020 年的旧版本 / 只带其中一个 → **全部 400** |
| CART-LEGAL-02 | PASS | 三次被拒后购物车**原样保留**：1 件商品、状态仍是 Active |
| CART-EXPIRY | PASS | 购物车自带 `expiresAt`（外带 24 小时） |

## 4. 与并行会话的分工

| 面 | 谁跑的 |
|---|---|
| 并发加购、幂等键、库存竞争、取消竞态 | 并行会话（本地随机测试） |
| 数量边界、备注 4000/4001 字、Unicode/RTL | 并行会话 |
| **服务端价格重算、外部 optionId、跨餐厅注入** | 本轮 |
| **菜单中途变化的重校验、法律确认、凭证隔离** | 本轮 |

两边**不重复计数**。

## 5. 一次必须说明的返工

第一轮 `CART-OPT-12/14` 报 FAIL，看起来像「改价后仍按旧价收钱」——**是假的**。

我的改价请求返回了 **400**：
```
This save is missing the item version it was based on, so it cannot be checked
against changes made by anyone else. Reload the item and try again.
```
菜品更新要求带 `expectedUpdatedAt` 做乐观并发校验。价格**自始至终是 10.00**，所以那两条断言什么都没测到。

带上 `expectedUpdatedAt` 重跑后，改价真正生效（10.00 → 25.00），两条都通过。

> 顺带一提，那个 400 本身是好设计：不带版本号的保存会被拒，避免两个管理员互相覆盖。
> 这也是今天第二次栽在「断言看的信号不等于我以为的含义」上（第一次是 `/api/order/guest` 用空列表而非状态码表示无权）。
> **写断言前先确认前置操作真的成功了。**

## 6. 覆盖矩阵更新

| 模块 | 用例数 | 此前 | 现在 |
|---|---:|---|---|
| **cart** | 294 | 🟡 抽测 | 🟡 **价格完整性 + 重校验面已深跑**（29/29），并发面由并行会话覆盖；UI 与共享桌台实时面待跑 |

## 7. 仍未覆盖

- **第 7、14 节**：抽屉布局、四个重点页面的交接、跨页订单——需浏览器。
- **第 11 节 共享桌台实时**：多人同时改同一张桌的购物车，需双会话。
- **CART-OPT-11 多币种**：需要非 AUD 餐厅夹具。
- **CART-OPT-15~17 过敏原展示与快照**：本轮只验证了下单会快照（见 09-15 轮），未逐条核对展示层级。
- **第 15 节 故障恢复**：服务重启、缓存、网络中断。
