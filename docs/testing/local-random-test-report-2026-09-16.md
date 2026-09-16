# 本地随机测试报告 — 2026-09-16

## 环境与结果

- 分支：`jianda-payment-test-2026-09-16`，提交 `b383b05cb564c2e7b59005974990e703b4f0232b`；开始时工作区干净。
- 环境：本地 Docker，前端 `http://localhost:5173`，API `http://localhost:5000`，本地 PostgreSQL。未访问或修改生产。
- 初次发现后端容器仍为 09-12 旧构建；已用当前分支执行 `docker compose up -d --build --no-deps backend`，以下结果仅计重建后运行。
- API 随机/并发与源码核查：**51 PASS / 4 FAIL，4 个独立缺陷**。不是全系统或浏览器验收结论。
- 固定随机种子 `9162026`。脚本、逐项结果见 `test-results/20260916-130254/probe.mjs`、`results.json`、`order-probe.mjs`、`order-results.json`。
- 最初脚本响应解包错误及旧镜像结果不计产品缺陷。一次过密请求触发 120 次/分钟限流；后续缩小单购物车批次。

## 已确认问题

### LOCAL-0916-01 · P1 · Guest 结账重试返回不可用凭证

复现：Guest 加菜并 checkout，保留首次凭证；对同一个 cart 再 checkout；分别通过 `POST /api/order/guest` 查询同一订单。

实际：两次 checkout 都为 200、同一个 orderId；重试返回非空新 guestAccessToken，但新凭证查询结果为空、取消订单返回 403；首次凭证仍能查询。

影响：首次响应丢失时无法恢复订单访问；客户端用重试结果覆盖原凭证后，也可能失去订单查看/取消能力。独立复现三轮。

原因：`PublicCartsController.cs` 重试分支（约 884–915 行）更新 GuestAccessTokenHash 后 SaveChanges，但 `LoadOrderAsync`（约 1671 行）使用 `AsNoTracking()`，更新未持久化。

建议：按明确的跟踪/条件更新策略持久化凭证，并覆盖响应丢失恢复和多设备重试凭证策略。修复后验证返回的新凭证可读、可取消，同时明确其他参与设备的访问行为。

### LOCAL-0916-02 · P1 · 删除在购物车中被引用的菜品返回 HTTP 500

复现：创建专用菜品、加入购物车；Admin 调 `DELETE /api/admin/menu/items/{id}`。

实际：500；PostgreSQL `23503`，约束 `FK_CartItems_MenuItems_MenuItemId`。当前分支可重复复现。Development 响应带堆栈不单独认定为生产泄漏。

原因：`AdminMenuItemsController.DeleteItem`（约 1009–1037 行）直接 Remove/SaveChanges，未处理购物车引用。

建议：使用明确的归档/下架策略，或返回可操作的 409；覆盖活跃及历史购物车引用，验证顾客购物车提示一致。

### LOCAL-0916-03 · P2 · 选项组接受负数 MinSelections

复现：`POST /api/menu/items/{itemId}/option-groups`，`{name:"Negative bounds",minSelections:-2,maxSelections:1}`。

实际：201，保存 `minSelections=-2`。预期拒绝负数下界。

原因：`MenuOptionGroupController.CreateGroup` 校验 max>=1、必选 min>=1、min<=max，但可选组缺少 min>=0 校验。Update 路径也需一起检查。

### LOCAL-0916-04 · P2 · 库存整数溢出返回 HTTP 500

复现：专用菜品库存设为 `2147483647`（200），再 `PATCH /api/admin/menu/items/{id}/stock`，`{adjustBy:1}`。

实际：500。预期受控拒绝超范围操作，不应产生未处理异常。

原因线索：`AdminMenuItemsController.UpdateStock`（约 806 行）在数据库整数表达式中直接相加后 Math.Max，缺少上限溢出校验。

## 通过的主要测试

- 空/纯空白选项组名均 400：旧报告中的修复在当前分支有效。
- 数量 -1、0、101、int.MaxValue、1.5 均拒绝；备注 4000 字通过、4001 字拒绝。
- Guest 订单级备注保留过敏原文字、Emoji、RTL、HTML-like 文本。这里只验证存取，不代表 UI/打印防注入验收。
- 8 个并发请求使用同一个幂等键，只增加 1 份。
- 25 次固定种子随机加菜，每次核对各行数量、总数量、金额；最终 71 份、230.75。
- 5 轮减数量/删除竞争：最终为空，无 500。
- 8 请求竞争 3 份购物车库存：恰好 3 次成功，剩余 409。
- 无凭证和其他 takeaway cart 凭证不能读取购物车。
- 缺少法律确认的 checkout 400，购物车保持不变。
- 两个独立购物车竞争最后 1 份 checkout：200/409；订单重试保持同一个 orderId。
- 使用有效原始凭证，3 次并发取消得到 200/409/409，库存从 0 恢复为 1，仅归还一次。
- 错误 Guest 凭证无法读取订单。

## 范围限制与后续

- 浏览器 UI、真实设备和打印：本轮未执行，不计 PASS。
- Stripe 支付、真实退款、退款后 addon/item 归还：本轮未执行；取消归还不等于退款归还。
- Addon 库存、多身份同桌所有权及时间边界：尚未完成专项执行。
- 现金找零上限：源码仍只校验下限，已有生产报告记录，本轮未新增实测结论。
- 邮箱相关用例：用户将提供两个已登录邮箱，接下来在本地单独记录执行。
- 本轮仅记录缺陷，没有修改业务代码。测试目录被 gitignore 忽略；本报告可提交版本管理。

## 测试数据

- 使用 `LOCAL-RANDOM-20260916-*` 和 `LOCAL-ORDER-PROBE-*` 专用菜品。
- 订单测试共创建 3 个未支付订单；收尾时全部 Cancelled，库存各恢复为 1，专用菜品均已下架。保留订单/审计作为测试证据。
- 随机测试菜品已删除。早期因限流未清空的购物车条目，按已核实 cartId/menuItemId 精确清理，再删除对应临时菜品；空购物车保留至正常过期。
- 邮箱阶段：尝试打开 Gmail 被自动审批拒绝，原因是连接器需 Gmail origin 访问权限，超出仅阅读测试邮件的窄范围；未读取邮箱，等待用户确认此站点权限或改用用户接力邮件内容。
