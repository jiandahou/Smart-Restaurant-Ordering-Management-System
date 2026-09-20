# 断网行为测试 — 2026-09-20

补上清单里一直挂着的「页面级断网」一项。生产环境（`dineflow.theunknownfish.com`），
真实的浏览器级断网：Chrome DevTools → Network → Offline，只断那一个标签页。

> 为什么不关 Wi-Fi：那会把测试者自己的连接一起切断，断网期间没法操作也没法观察，
> 最关键的「断网时点提交」只能靠人工点、事后看结果。DevTools 的按标签页断网保留了全程可控。

**结论：核心安全性全部通过，没有幽灵订单、没有重复下单、断网恢复不需要刷新。
两个缺陷都在提示层面——顾客根本不知道自己断网了。**

| 用例 | 结果 |
|---|---|
| OFF-01 断网后购物车内容是否保留 | ✅ 完整保留 |
| OFF-02 页面是否告知顾客已断网 | ❌ **完全没有任何提示** → 已修 |
| OFF-03 断网时加菜的报错文案 | ❌ **直接显示 "Failed to fetch"** → 已修 |
| OFF-04 断网时加菜会不会产生脏状态 | ✅ 拒绝加入，前后端都没留痕 |
| OFF-05 断网时点结算 | ✅ 被拦住，**后端零幽灵订单** |
| OFF-06 恢复后是否需要刷新 | ✅ 不需要，自愈 |
| OFF-07 恢复后重新下单会不会重复 | ✅ 只产生 1 单 |
| OFF-08 并发双击 + 超时重试提交 | ✅ 幂等，三次返回同一个订单号 |
| OFF-09 共享购物车 SignalR 短断网（20s）恢复 | ✅ 自动重连并重新 JoinCart |
| OFF-10 共享购物车 SignalR 长断网（>3min）恢复 | ✅ 重建连接，购物车与服务端重新对齐 |

---

## 测试环境

- T5 桌 QR 点单页，两件商品：Mango Lassi (Regular) A$7.41 + Masala Chai A$4.50 = **A$11.91**
- 共享购物车 `128eb6f0-…`，SignalR `JoinCart succeeded`
- `localStorage` 为空 → **购物车在服务端，不在本地**
- 基线：T5 活动订单 0，餐厅 A 最新单 `ORD-20260920-186651`

断网确认：`navigator.onLine === false`，`fetch()` 抛 `TypeError: Failed to fetch`。

---

## 通过的部分

**购物车不丢。** 断网后购物车仍是 2 件 A$11.91。因为购物车存在服务端 + 内存，不依赖本地存储。

**断网时加菜被干净地拒绝。** 弹窗不关闭、商品不进购物车、服务端也没有半成品记录。

**断网时进不了结算——这一条比看上去重要得多。**
「Go to checkout」本身就是**下单动作**（`POST /api/public/carts/{cartId}/checkout` 直接创建订单）。
断网时它被服务端校验挡住，**后端零幽灵订单**：T5 活动订单数始终为 0，订单列表没有任何新增。

**恢复不需要刷新。** 切回在线后，不刷新直接点结算就成功了，创建了 `ORD-20260920-388148`
（T5，A$11.91，Pending/Unpaid）。购物车内容一字不差。

**只产生 1 单，没有重复。** 对比基线只多出这一单。

**提交是幂等的。** 单独在 T4 桌用 API 验证了真实世界最危险的那个场景——请求发出去了但响应丢了、
顾客以为失败又点一次：

```
并发 checkout #0 -> 200  order=ORD-20260920-905919
并发 checkout #1 -> 200  order=ORD-20260920-905919
重试 checkout    -> 200  order=ORD-20260920-905919
后端实际存在的该订单数量：1
```

三次调用返回同一个订单号。控制器里对购物车行加了 `SELECT … FOR UPDATE` 并在事务内处理，
把并发串行化掉了。

**未付款订单的提示写得很好**（值得保留的正面样本）：

> "You have an order waiting to be paid. Order ORD-20260920-388148 for A$11.91 was placed but not
> paid for. It is holding your items until it is paid or expires. If you do nothing, it expires on
> its own in 17 minutes and the items go back on the menu. You will not be charged."

说清了钱、时间、后果，还主动澄清不会扣款。

---

## 缺陷

### OFF-02 页面完全不告诉顾客断网了（提示缺失）

断网整整五分钟，页面上找不到任何相关字样：

```js
['offline','Offline','connection','network','reconnect','断网','连接'] → []
```

顾客看到的是一个「一切正常」的菜单，点什么都失败，且不知道为什么。
店里 Wi-Fi 抖一下、或者顾客手机走进信号死角，就是这个体验。

### OFF-03 把浏览器原始报错甩给顾客（文案）

断网时加菜、点结算，弹出的提示是字面的 **"Failed to fetch"**——这是 `TypeError` 的
`message` 直接进了 toast。对顾客毫无意义，也不告诉他该怎么办（等一下、还是叫店员）。

两条其实是同一个根因：前端没有断网感知。

### 已修

**OFF-02** 新增 `src/components/OfflineNotice.tsx`，挂在 `App` 里路由之上，
所以顾客页和员工页一起覆盖（店里平板掉 Wi-Fi 是同一个问题）。断网时置顶显示一条常驻提示条。
初始状态直接读 `navigator.onLine` 而不是等事件——`online`/`offline` 是边沿触发的，
从 bfcache 恢复、或挂载前网络就已经断了的标签页，永远等不到那个事件。

文案只承诺「没有东西被发出去」，**不承诺购物车已保存**：购物车在服务端，
屏幕上显示的是最后一次拉取到的状态，说「已保存」是猜测。

**OFF-03** `src/api/auth.ts` 新增 `NetworkError`（继承 `ApiError`，`status: 0`、
`code: 'network_unavailable'`，保证已有的 5 处 `instanceof ApiError` 判断不受影响）
和 `fetchOrNetworkError()`，把 `fetch` 的传输层异常翻译成人话。
只翻译 rejection——HTTP 错误是服务端给的真实答复，仍然交给调用方。
`AbortError` 原样放行，那是应用自己取消的，报成断网是撒谎。

区分了两种情况：设备断网说「You appear to be offline」，设备在线但连不上 DineFlow 说
「Could not reach DineFlow」——对着满格信号的人说他断网了，会让他去修错的东西。

已接入 `request`、`requestBlob` 和两处直传存储的上传。

回归测试 `src/api/networkError.test.ts`（8 条）和
`src/components/OfflineNotice.test.tsx`（6 条）。两份都把修复退掉验证过会失败
（分别挂 4 条和 3 条）。前端全量 1106 passed，`tsc --noEmit` 干净，生产构建通过。

---

## 两次被我自己纠正的判断

记下来，因为两次都差点写成错误结论。

**一、「没有重连日志」不等于「没有重连」。**
[cartConnection.ts:62](../../frontend/dineflow-web/src/realtime/cartConnection.ts#L62) 的
`onreconnected` 里**只有失败分支有 `console.error`**，成功重连一行日志都不打。
我一度据此判定「连接永久失联」，证据是不成立的。只能靠功能验证：
让第二位「同桌顾客」通过 API 往同一个购物车加菜，看页面收不收得到。

**二、代码推断出来的缺陷，测下来是不存在的。**
`withAutomaticReconnect([0, 2_000, 5_000, 10_000, 30_000])` 是 5 次重试、约 47 秒预算，
而且 `cartConnection.ts` 没有 `onclose` 兜底（订单 hub
[orderConnection.ts:71](../../frontend/dineflow-web/src/realtime/orderConnection.ts#L71) 是有的）。
据此我推断「断网超过 47 秒就永久失联」，并且差点把它写成实锤缺陷。

实测**不成立**：

- 20 秒断网 → 自动重连，恢复后同桌加菜 3 秒内收到（7:10:52）
- 超过 3 分钟断网 → 应用**重建了一条新连接**（7:13:29 打出全新的 `Connecting` +
  `JoinCart succeeded`，是 `start()` 的日志而非 `onreconnected`），
  购物车从落后的 2 件 A$12.50 **自动对齐到服务端的 3 件 A$19.91**
- 再推一条 → 页面同步到 4 件 A$32.41，与服务端完全一致

中途还有一次假阳性：我以为已经恢复在线，实际那个标签页还停在 Offline
（`navigator.onLine === false`），推送收不到是因为还断着，不是因为连接死了。
**此后每次推数据前都先确认 `navigator.onLine === true`。**

教训一致：读代码只能产生假设，上线判断必须有功能验证。

---

## 遗留

- 测试产生了两笔未付款订单 `ORD-20260920-388148`（T5 A$11.91）、
  `ORD-20260920-905919`（T4 A$61.41），按产品设计会在约 17 分钟后自动过期并把库存放回菜单，
  不需要人工处理。
- 本次未覆盖：**请求已到达服务端但响应在传输中丢失**的真实时序（OFF-08 用并发和重试逼近了
  这个场景，幂等性成立，但没有真的在 TCP 层切断一个已发出的请求）。
- 本次未覆盖：断网状态下的**在线支付**流程（Stripe Checkout 是跳出站外的页面，断网点不进去）。
