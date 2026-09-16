# admin-reports 生产测试run — 2026-09-16

> 09-15 总报告里 `admin-reports(176)` 是 🟡 抽测。本轮把 API 面跑深，重点在**权限、租户隔离、隐私最小化、导出与不可变性**。
> 接力入口：[production-test-report-2026-09-16.md](production-test-report-2026-09-16.md)

## 0. 运行信息

| 字段 | 值 |
|---|---|
| 日期 | 2026-09-16 (ACST)，`main` @ `6ed7440` |
| 环境 | Production `https://dineflow.theunknownfish.com`，**全部只读**（报表接口本就没有写端点） |
| 角色 | Owner A / Admin A / Admin B / Staff A / Customer A / 匿名 |
| 数据规模 | activity 311 · audit 293 · orders 143 · payments 91（餐厅 A 范围） |

## 1. 结论

- **35 项检查：32 PASS / 2 FAIL / 1 NOT RUN。**
- **权限与隐私是这个模块最强的一面**：四个标签 + 四个导出，对 Guest/Customer/Staff 全部拒绝；
  Admin A 无论怎么传 `restaurantId=B` 都拿不到一行 B 的数据；IP/UA/CorrelationId 对非 PlatformOwner
  **在 JSON 里置 null、在 CSV 里整列删掉**。
- 2 个 FAIL 都不是安全问题：一个是 API 契约不一致，一个是**导出缺金额字段**。

## 2. 权限、租户与隐私（P0 集中区，全绿）

| 用例 | 结果 | 观察 |
|---|---|---|
| RPT-ROLE-01 | PASS | 匿名调 4 个标签 → 全 401 |
| **RPT-ROLE-02** | PASS | Customer 调 **4 标签 + 4 导出 → 全 403** |
| **RPT-ROLE-03** | PASS | Staff 调 **4 标签 + 4 导出 → 全 403** |
| RPT-ROLE-04 | PASS | Admin A 四个标签共 391 行，**外店行数 0** |
| **RPT-ROLE-05** | PASS | Admin A 强传 `restaurantId=B` → 四个标签都返回 **0 行**（收窄而非报错，也不泄露 B 是否存在） |
| **RPT-ROLE-05b** | PASS | 同样参数走**导出** → 4 个 CSV 里**没有一个 B 的 id** |
| RPT-ROLE-10 | PASS | 宽泛搜索 `ORD` / `@dineflow` / `customer`（143 + 76 + 4 行）→ 外租户 0 |
| **RPT-ROLE-08** | PASS | Admin/Owner 读 audit：`ipAddress`/`userAgent`/`correlationId` **值为 null**；写入时是记录了的（`ReportLogWriter.cs:192`），读取时按角色抹掉（`AdminReportsController.cs:854`）——存证与最小化两头都顾到了 |
| **RPT-EXP-09** | PASS（Admin 侧） | Admin 的 audit CSV 表头是 `CreatedAt,Action,ActorEmail,ActorRoles,ActorType,Source,EntityType,EntityId,RestaurantId,Summary` —— 敏感列**整列不存在**，不是留空。全文件 0 个 IPv4、0 个 `Mozilla/` |
| RPT-ROLE-09 | **BLOCKED** | PlatformOwner 侧需要 `owner@dineflow.com` 新密码（承接 09-15 问题 #3） |

## 3. 导出、分页与数据准确性

| 用例 | 结果 | 观察 |
|---|---|---|
| RPT-PRE-05 | PASS | policy：`maxExportRows 5000`、audit 2555 天、order 730 天、payment 2555 天、`logsAreImmutable: true`、`sensitiveTechnicalDetailsRequirePlatformOwner: true` |
| **RPT-EXP-13** | PASS | 对 4 个报表端点做 **16 次写尝试**（POST/PUT/PATCH/DELETE）→ **无一被接受**，报表面确实只读 |
| **RPT-EXP-02** | PASS | 导出行数与列表 `totalItems` **逐个相等**：audit 293=293、orders 143=143、payments 91=91 —— 导的是完整匹配集，不是当前页 |
| RPT-EXP-02b | PASS | 加 `search=customer` 后：列表 4、CSV 4，筛选同步收窄 |
| RPT-EXP-03 | PASS | 四个 CSV 全扫，**无以 `=` `+` `@` 开头的单元格**，不会在 Excel 里当公式执行 |
| RPT-EXP-12 | PASS | 无 password/secret/jwt/apikey 列。（audit CSV 里出现的 `token` 是动作名 `Auth.TokenRefreshed`，不是凭据） |
| RPT-EXP-06 | PASS | 时间戳形如 `2026-09-16T03:27:48.2860720Z`，**显式 UTC**，不拿本地时间冒充 |
| RPT-PAGE-13 | PASS | 翻 6 页走完 293 行 audit，**重复 0 条** |
| RPT-DATE-01 | PASS | `createdFrom=2026-09-16` → 100 行，**0 行早于边界** |
| RPT-PAGE-07 | PASS | 空结果集 → 200，`totalItems=0`、`page=1`，没有「Page 0 of 0」那类异常模型 |
| RPT-PAGE-04 | PASS | **44 组非法深链参数**（负页码、`pageSize=abc`、`from=2026-13-45`、`%00`、`<script>`、起止日期倒置…）→ **无 500、无 NaN** |
| RPT-SORT-02 | PASS | `sortBy=DROP TABLE` → 400 并列出允许值，是白名单不是拼 SQL |
| **RPT-EXP-05** | **FAIL** | **payments 导出没有任何金额/币种列** —— 见第 4 节 #2 |
| **RPT-SORT-01** | **FAIL** | **不传 `sortBy` 时四个标签行为不一致** —— 见第 4 节 #1 |
| RPT-EXP-08 | NOT RUN | 5000 行截断告警：当前最大标签只有 311 行，需要批量夹具才能验 |

## 4. 发现的问题

### #1 不传 `sortBy` 时四个标签行为不一致（低，API 契约）

| 标签 | `GET .../{tab}?pageSize=5` |
|---|---|
| activity | **200** |
| audit / orders / payments | **400** `{"message":"Unsupported sortBy value.","allowedValues":[...]}` |

`ReportLogListRequest` 继承的 `PagedRequest.SortBy` 默认是 `null`
（[PagedRequest.cs:16](../../backend/dineflow/DineFlow.Api/Contracts/Common/PagedRequest.cs#L16)），
而 `ApplyAuditSorting(null)` 返回 null 就直接 400。所以这三个标签的 `sortBy`
**看起来可选、实际必填**，而且报错说的是「值不支持」而不是「缺少参数」。

**影响有限**：前端在 [AdminReportsPage.tsx:346](../../frontend/dineflow-web/src/pages/AdminReportsPage.tsx#L346)
写死了 `sortBy: 'createdAt'`，UI 碰不到。但任何直接调 API 的集成方、脚本或文档示例都会踩。

> **顺带更正 09-15 报告**：那份报告把这三个标签的 400 记成「需正确日期参数」。
> 实测与日期无关——传不传 `createdFrom/createdTo` 都一样，**缺的是 `sortBy`**。

**建议**：给 `ApplyAuditSorting` 一个 `createdAt` 默认值，与 activity 标签对齐。

### #2 payments 导出不含金额与币种（中，对账/合规证据）

payments 导出的完整表头：

```
CreatedAt,EventType,Provider,ProviderEventId,Status,OrderNumber,OrderId,
PaymentId,PaymentRefundId,RestaurantId,ActorDisplayName,ActorRoles,ActorType,Source,Message
```

**没有 Amount、没有 AmountCents、没有 Currency。**

根因在实体本身：[PaymentEventLog.cs](../../backend/dineflow/DineFlow.Infrastructure/Reporting/PaymentEventLog.cs)
**根本没有金额字段**。唯一可能装金额的是 `DataJson`，而 `DataJson` 和 `CorrelationId` 一样
**只对 PlatformOwner 导出**（`AdminReportsController.cs` 的 payments 导出分支）。

**为什么要紧**：payment 事件的保留期是 **2555 天（7 年）**，这明显是按财务/合规证据设计的。
但真正要对账的人——餐厅 Owner/Admin——导出来的 7 年流水只能看到**发生了什么**
（`counter.recorded`、`checkout_session.created`、状态、谁操作的），**永远看不到多少钱**。
要拿到金额必须再按 `PaymentId` 回表查 Payments，而那张表不受这套不可变留存策略保护。

**建议**：给 `PaymentEventLog` 加 `AmountCents` + `Currency` 两列并在写入时填充，
导出对所有授权角色都带上。这两个字段是金额本身，不属于需要按角色屏蔽的技术细节。

## 5. 未覆盖（下一棒）

- **RPT-ROLE-09 / RPT-EXP-09 的 PlatformOwner 侧**：需要 `owner@dineflow.com` 新密码。
- **RPT-EXP-07/08**：5000 行边界与截断告警，需要批量夹具。
- **第 6 节 可读性与视觉层级（24）**、**第 13 节 无障碍/响应式/主题/缩放（16）**：纯 UI，需浏览器。
- **RPT-PAGE-05/06/08/10/11/12**：浏览历史、loading、失败重试、双击防抖、快速切标签的竞态。
- **RPT-EXP-04**：Unicode/长文本/换行/引号的 CSV 往返——需要先造带这些内容的夹具。
- **RPT-EXP-14 / legal hold**：保留期「已声明 vs 已执行」的一致性，需要看定时任务与归档配置。

## 6. 覆盖矩阵更新

| 模块 | 用例数 | 09-15 | 09-16 |
|---|---:|---|---|
| **admin-reports** | 176 | 🟡 抽测 | 🟡 **权限/隐私/导出面已深跑**（35 项，32 PASS / 2 FAIL / 1 NOT RUN）；UI 与可读性待跑 |
