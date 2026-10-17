# 本地点餐核心链路风险抽测（2026-09-16 夜间）

环境：本地 Docker，分支 `jianda-payment-test-2026-09-16`，起始提交 `6a761051ec511f29a667e3b2e69147fc45349d45`。开始时仅共享测试报告有未提交修改。时间：Australia/Adelaide。本轮不修改业务实现，不提交或推送。

## 结果与覆盖边界

| 层级 | 结果 | 说明 |
|---|---|---|
| 前端定向自动测试 | 42 PASS / 0 FAIL | carts API、备注、会话恢复、退款金额、支付轮询；Node 26.7.0，项目声明 >=22 |
| 后端定向回归 + 隔离 PostgreSQL | 474 PASS / 2 FAIL / 0 SKIP | Cart / Refund / StaffOrder / Payment / Stock 名称过滤；.NET SDK 8 官方容器。包含单元、源码契约及真实数据库集成测试，不等于 476 次端到端业务流程 |
| 运行中本地 API | 15 PASS + 2 清理检查 PASS | 专用菜品、独立 Takeaway cart；无订单生成 |
| UI 抽查 | 下列观察正常 | 未作为完整浏览器用例矩阵统计 |

第一次后端运行未配置测试 DB，413 PASS / 63 SKIP；上述 474/2/0 是随后在一次性 PostgreSQL 中补跑结果，不重复相加。本机只有 .NET 10，不能运行 net8 测试宿主，故使用已有 SDK 8 镜像。初次本机沙箱进程通信失败属于运行环境问题。

## 高风险项实测

- 12 个同幂等键并发加菜：全部 200，最终只有 1 份。
- 40 个不同幂等键并发加菜：全部 200，最终 40 份，单价 3.25、总额 130。
- 10 轮减数量与删除竞争：均收敛为空；响应 200/200 或 404/200，没有 500。
- 库存 3，10 个并发加菜：3 次 200、其余 409，最终 3 份。
- 错误参与凭证返回 401；缺法律同意的 checkout 返回 400。
- 后端集成测试已实际启用 PostgreSQL，退款库存、退款失败乱序、重复收款、员工队列等受过滤器选中的测试没有再跳过。Stripe 客户端模拟测试不代表真实 Sandbox 验收。

## UI 观察

- Takeaway 深链直接显示 Takeaway，没有再次强制选类型。
- Veg Spring Rolls：9.50 + Mint chutney 0.74 + Extra roll 3.33，数量 2；商品弹窗与购物车均为 27.14，备注保存正确。
- 删除该测试行后购物车数量/总额为 0，checkout 禁用；未提交订单。
- Staff Orders 当前登录是 Platform Owner，不是独立 Staff 账号。Payment holds 中未付款与全额退款订单没有正常制作按钮，厨房打印按钮禁用，显示支付阻断原因；仅只读观察历史记录。
- 现场配置提示 `star` 打印机 PAUSED，Auto accept ON。未切换设置、未清理打印队列、未对既有订单操作。

## 新发现：测试夹具依赖实际营业时间

优先级：P1（回归验证可靠性），不是已确认的新产品删除缺陷。

`LocalRandomFindingsRegressionTests.DeletingAnItemHeldInALiveCart_IsRefusedInsteadOfCrashing` 和 `DeletingAnItemHeldOnlyInAFinishedCart_Succeeds`：完整批次及独立复跑均失败。原异常是 NullReferenceException，尚未到删除请求。

增加仅测试用的 join 失败断言后，确认真实响应：HTTP 409，`Restaurant is outside opening hours and is not accepting orders right now.`，reason `Closed`。夹具 `SeedMenuAsync` 使用 Australia/Adelaide，却没有固定可接单状态或时钟。夜间运行会在创建购物车阶段失败。

建议：固定测试时钟或为该夹具明确设置全时营业，再验证预期 409/200 删除结果。本轮只补诊断断言，未实现该修复。不可把这两条失败解释为删除接口返回 500，也不可把它们标成通过。

## 尚未执行

- 真实 Stripe Sandbox 新订单付款 → webhook → 全额/部分退款 → 后台对账：尚未确认本轮 connected account 与 Sandbox 模式，未发起资金写操作。
- 运行中本地栈完整下单 → Staff 接单/出餐：需先隔离实际打印队列；当前只做购物车 UI/API 与独立数据库测试。
- 独立 Staff 身份浏览器操作、跨租户 UI、多人同桌真实设备断网恢复、实体出票：未测。

## 清理及证据

专用 API cart 已清空，专用菜品已下架（保留用于追踪，不删除）。UI 测试购物车已清空。未改营业库存、未创建运行栈订单、未调用真实 Stripe、未打印。

原始证据（gitignore，不随仓库共享）：`test-results/20260916-215501/cart-probe.mjs`、`cart-results.json`、`logs/core-results.trx`。本报告保留了可共享的结果与复现原因，不保存认证凭证。
