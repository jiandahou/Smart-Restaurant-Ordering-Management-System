# Admin Menu / SignalR / 营业日历 三块补测 — 2026-09-18

> 一次跑掉 [缺口清单](release-gap-review-2026-09-18.md) 里三个模块的剩余项：
> Admin Menu 的图片上传与过敏原、Notifications 的 Hub 授权、Admin Restaurants 的特殊营业日与跨午夜。
> 营业日历部分**只在本地栈执行**（涉及配置写入），生产只做只读与专用订单。

## 0. 结论

- **29 项检查全部通过。**
- **MENU-ALG-04 关闭**——这条从 09-15 挂到现在的待确认项终于有答案。
- **跨午夜营业时间可用**：17:00–02:00 被接受，本地时间 01:10 判定为营业中，顾客能下单。
- 未发现产品缺陷。**但本轮有一次差点报出不存在的缺陷**，见第 5 节。

## 1. Admin Menu：过敏原（5/5）

| 用例 | 结果 | 观察 |
|---|---|---|
| **MENU-ALG-04** | PASS | **09-15 遗留问题的答案**：无过敏原声明创建的菜品，`allergenInfoLastVerifiedAt` 就是 `null`（`allergens`、`mayContainAllergens` 同为 null）。**行为正确，可以关闭** |
| MENU-ALG-05 | PASS | 声明过敏原并勾选已核验 → 打上时间戳 `2026-09-17T15:38:15Z` |
| **MENU-ALG-08** | PASS | 「无麸质」+ 过敏原含 Wheat → **409**，而且**点名冲突**：`Marked gluten free, but the allergens text mentions "wheat".` |
| MENU-ALG-08b | PASS | 带 `acknowledgeDietaryConflicts` 再提交 → 201。**人可以明确覆盖，沉默不行** |
| MENU-ALG-09 | PASS | 「素食」+ 过敏原含 Milk/Egg → 409 |
| MENU-ALG-10 | PASS | 「无麸质」+ **「可能含有」**写 Gluten → 409。可能含有那一列也算数 |

## 2. Admin Menu：图片上传（4/4）

| 用例 | 结果 | 观察 |
|---|---|---|
| MENU-IMG-01 | PASS | 250KB png 预签名 → 200，返回 `uploadUrl` / `imageUrl` / `objectKey` / `headers` / `expiresAt` |
| **MENU-IMG-02** | PASS | 9MB、0 字节、负数、**SVG**、exe、html → **全部 400**。SVG 被拒尤其重要，它可以携带脚本 |
| MENU-IMG-03 | PASS | 为另一家餐厅预签名 → 403 |
| MENU-IMG-04 | PASS | Staff 预签名 → 403 |

## 3. 顾客端联动（3/3）

| 用例 | 结果 | 观察 |
|---|---|---|
| MENU-PUB-01 | PASS | 后台标售罄 → 顾客菜单上该菜 `isSoldOut` 由 false 变 true |
| MENU-PUB-02 | PASS | 下架 → 顾客菜单上**整个消失** |
| MENU-PUB-03 | PASS | 公共库存端点 200，24 条 |

## 4. SignalR Hub 授权（4/4）

| 用例 | 结果 | 观察 |
|---|---|---|
| RT-HUB-01 | PASS | Cart Hub `negotiate` 免鉴权 → 200。**这是有意的**：真正的门在 `JoinCart`，它要校验 participant token |
| **RT-HUB-02** | PASS | Order Hub 无鉴权 → **401** |
| **RT-HUB-03** | PASS | Order Hub 用 **Customer** 身份 → **403**。顾客订阅不了厨房事件流 |
| RT-HUB-04 | PASS | Order Hub 用 Staff → 200 |

## 5. 营业日历（本地栈，13/13）

| 用例 | 结果 | 观察 |
|---|---|---|
| **SD-06/07** | PASS | **跨午夜营业时间 17:00–02:00 被接受**；本地时间 **01:10 判定为营业中**，顾客 join 200 |
| **SD-CLOSE** | PASS | 特殊日 `isClosed:true` → 原本营业的一天变关门，顾客 409 |
| **SD-OPEN** | PASS | 常规七天全关（join 409）+ 特殊日 `isClosed:false` 带窗口 → **join 200**，`reason=Open`。**特殊日双向都生效** |
| SD-VALID | PASS | 特殊日校验与常规营业时间**同一套规则**：同时刻 400、格式错 400、日期错 400、非 JSON 400、**跨午夜 200** |
| QR-01 | PASS | 启用桌台的二维码 → 200，解析出桌号，`orderType=DineIn` |
| **QR-04/05** | PASS | **停用桌台**的二维码 → 404「Table QR code is invalid or unavailable.」，据此 join 购物车也 404 |
| QR-03 | PASS | 大小写改动过的 token → 404，token 是精确匹配 |
| SD-RESTORE | PASS | 本地餐厅营业时间与特殊日**逐字节还原**，顾客可下单 |

### 营业时间窗口的真实规则（本轮测出）

| 窗口 | 结果 |
|---|---|
| `09:00-21:00` 普通 | 200 |
| `17:00-02:00` 跨夜 | **200** |
| `18:00-09:00` 长跨夜 | **200** |
| `00:00-00:00` | 200（全天） |
| `12:00-12:00` 同时刻 | 400「cannot be the same, except 00:00」 |
| `99:99-aa:bb` | 400「must use HH:mm format」 |
| 只传一天（不足七天） | 400「must contain one entry for each day of week 0-6」 |

## 6. 我差点报出一个不存在的缺陷

第一轮我用 `isOpen` 描述特殊日，得到的结论是「**特殊日能关店但不能开店**」，看着像一个实实在在的功能缺陷
（「平时周一休息，这个周一因活动营业」将无法表达）。

真相是契约字段叫 **`isClosed`**。未知字段被忽略，`IsClosed` 默认 `true`，
所以**我发过去的每一条特殊日都被存成了「当天休息」**，窗口被整个丢弃：

```
sent  isOpen:true + windows  ->  200
stored [{"date":"2026-09-18","isClosed":true,"note":null,"windows":[]}]
```

用 `isClosed:false` 重测后，开店方向**正常工作**。

> 这是今天第八次契约误判，**也是后果最接近失控的一次**：前几次只是白测或写错理由，
> 这一次差一点把一个**不存在的产品缺陷**写进发布清单，而它看起来非常可信。
> 真正救回来的动作是：**去看存储后的实际值**，而不是只看 200。

## 7. 对 09-16 报告的更正

同一类问题让我发现 [write-paths 报告](write-paths-test-run-2026-09-16.md) 里有一条结论是错的：
那里把「**收早于开**」列为被拒的非法输入，实际上**收早于开是合法的跨夜窗口**，
当时那四条 400 的真实原因是**每条只传了一天**。已在该报告加入更正段落。

## 8. 清单回填

| 清单项 | 此前 | 现在 |
|---|---|---|
| Admin Menu：图片上传/替换 | 剩余验收 | 🟡 **预签名与类型/大小/越权校验已跑**；真实上传与替换未跑 |
| Admin Menu：allergenInfoLastVerifiedAt | 09-15 待确认 | 🟢 **已关闭** |
| Admin Menu：售罄后顾客端实时反应 | 剩余验收 | 🟡 **API 层已验**（菜单立即反映）；UI 实时推送待双会话 |
| Admin Restaurants：特殊营业日、时区/跨午夜、桌码生命周期 | 剩余验收 | 🟢 **已跑**（本地栈，13/13） |
| Notifications：Hub 授权 | 部分 | 🟡 **negotiate 层授权已验**；断线补齐、重复事件、乱序仍需双会话 |

## 9. 仍未覆盖

- **真实图片上传与替换**：本轮只验了预签名契约，没有把字节传上 S3 再回写 `imageUrl`。
- **SignalR 事件语义**：重复事件、旧消息不覆盖新状态、断线补齐——需要真实 WebSocket 双会话。
- **生产环境的特殊营业日**：本轮只在本地栈写配置。首店营业时间定下来后需在生产确认一次。
