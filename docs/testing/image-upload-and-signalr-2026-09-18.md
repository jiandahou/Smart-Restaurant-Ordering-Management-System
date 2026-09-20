# 真实图片上传与 SignalR 双会话 — 2026-09-18

> [缺口清单](release-gap-review-2026-09-18.md) 剩下两项我还能独立完成的：
> Admin Menu 的**真实图片上传**（此前只验了预签名契约），以及
> Notifications 的**双会话实时推送**（此前只验了 negotiate 层授权）。
> 后者用自写的最小 RFC6455 + SignalR JSON 客户端驱动，是**真实 WebSocket**，不是 API 模拟。

## 0. 结论

- **16 项检查全部通过。**
- 图片链路从预签名一路走到顾客菜单，取回的字节与上传的**逐字节相同**。
- **实时推送确实在推**：一人改购物车，同桌另一人在真实 WebSocket 上收到带完整内容的事件。
- 未发现缺陷。

## 1. 图片上传全链路（7/7）

| 用例 | 结果 | 观察 |
|---|---|---|
| IMG-01 | PASS | 74 字节 PNG 预签名 → 200 |
| **IMG-02** | PASS | 服务端派发的 objectKey 落在**本餐厅专属前缀**内：`uploads/menu-items/{restaurantId}/…`，客户端无从指定 |
| IMG-03 | PASS | 按预签名 URL 与 headers **真实 PUT 字节** → 200 |
| IMG-04 | PASS | complete → 200，返回 S3 上的 `imageUrl` |
| **IMG-05** | PASS | **把图取回来**：200、74 字节、`Content-Type: image/png`、**PNG 魔数完好**，与上传内容一致 |
| IMG-06 | PASS | 挂到菜品后，**顾客菜单上就是这张图** |
| **IMG-07** | PASS | 认领**不是自己上传**的 objectKey —— 四种都 400：<br>· 另一家餐厅的前缀<br>· `../../../secret.png` 逃逸<br>· 任意键 `appsettings.json`<br>· 本店前缀下但**从未上传过**的键 |

`IMG-07` 最后一条尤其关键：光有正确前缀不够，服务端会去 S3 **确认对象真的存在**才接受。

## 2. SignalR 双会话（9/9）

用自写的最小 WebSocket + SignalR JSON 协议客户端，两个独立连接。

### 推送

| 用例 | 结果 | 观察 |
|---|---|---|
| **RT-PUSH-01** | PASS | B 订阅购物车后，A 加菜 → **B 收到 2 个事件**：`CartUpdated` 与 `CartItemAdded` |
| **RT-PUSH-02** | PASS | 事件**带完整购物车内容**（`reason: item-added` + 整个 cart 对象），不是让客户端再去拉一次的空通知 |
| RT-DUP-01 | PASS | 同一连接**重复 JoinCart 三次**后，一次变更仍只投递 2 个事件，没有按加入次数翻倍 |

### 组授权

| 用例 | 结果 | 观察 |
|---|---|---|
| **RT-AUTH-01** | PASS | 用**伪造 participant token** 调 JoinCart → 服务端回 **HubException** |
| **RT-AUTH-03** | PASS | 用**另一个购物车的合法 token** 调 JoinCart → 同样 **HubException**。合法但不属于这个车，一样进不去 |
| RT-AUTH-good | PASS | 用本车自己的 token → `result: null`，正常加入 |
| **RT-AUTH-02** | PASS | 被拒之后 A 继续改购物车，那个连接**收到 0 个事件**。不只是报错，是真的不在组里 |

> Cart Hub 标着 `[AllowAnonymous]`，一度看着像没有防护。
> 实际的门在 `JoinCart` 里：它调 `CartAccessService.AuthorizeAsync` 校验 participant token，
> 校验不过就抛 HubException。**连接可以匿名建立，但拿不到任何一个购物车的事件。**

## 3. 一处客户端侧的说明

前两轮 `RT-AUTH-01/03` 抓不到错误，看着像「服务端默默忽略了非法 JoinCart」。
原因是我发的 invocation **没带 `invocationId`** —— SignalR 对这种「即发即忘」不回完成帧。
补上 `invocationId` 后，两种非法 token 都拿到了明确的 HubException。

值得一提的是，即便在抓不到错误的那一轮，`RT-AUTH-02` 也已经证明了**安全属性是成立的**
（那个连接收到 0 个事件）。**行为证据比错误消息更可靠**——这次正好反过来帮了忙。

## 4. 清单回填

| 清单项 | 此前 | 现在 |
|---|---|---|
| Admin Menu：图片上传/替换 | 🟡 仅预签名契约 | 🟢 **全链路已跑**（上传→取回→挂菜品→顾客菜单→越权认领） |
| Notifications：双会话实时 | 🟡 仅 negotiate 授权 | 🟡 **推送与组授权已用真实 WebSocket 验证**；断线重连补齐、乱序、旧消息不覆盖新状态仍未跑 |

## 5. 仍未覆盖

- **断线重连补齐**：需要中断 WebSocket 再恢复，并核对期间遗漏的事件是否补上。
- **乱序与旧消息覆盖**：需要能控制事件投递顺序。
- **图片替换**：本轮只做了首次上传，替换旧图与旧对象清理未验。
- **Order Hub 的事件内容**：本轮只验了它的授权（Customer 403 / Staff 200），没有订阅厨房事件流。
