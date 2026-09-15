# Admin Menu 专项测试运行 — 2026-09-15（生产）

| 字段 | 值 |
|---|---|
| 环境 | Production（`https://dineflow.theunknownfish.com`），Stripe Sandbox |
| 分支/提交 | `main` @ `d1e22f0` |
| 范围 | admin-menu 的 **Auto（API 可自动化）** 用例:角色/租户、分类、菜品、库存、过敏原、选项组 |
| 未覆盖 | MENU-PAGE(页面/搜索/筛选)、MENU-IMG(图片上传)、MENU-REC/PUB(排序/顾客端一致性)、Assisted(顾客端对比)—— 需浏览器逐页,后续接力 |
| 数据 | 建了临时分类/菜品/选项组做测试,**已全部清理**（剩余 0） |

## 结果汇总

| PASS | FAIL | 未确认 | NOT RUN |
|---:|---:|---:|---:|
| 24 | 1 | 1 | 一批(PAGE/IMG/REC/PUB/Assisted) |

## 用例结果

| Case ID | 结果 | 实际观察 |
|---|---|---|
| MENU-ROLE-03 | PASS | Staff 调 sold-out/availability/stock → **403** |
| MENU-ROLE-04 | PASS | Staff 调选项组端点 → 403 |
| MENU-ROLE-06 | PASS | Admin A 调餐厅 B 菜品 GET/sold-out/stock/DELETE → **全 403**,B 数据不变 |
| MENU-ROLE-12 | PASS | 随机 GUID/畸形 id → 404,无堆栈/SQL |
| MENU-CAT-02 | PASS | 建分类 → 201 |
| MENU-CAT-03 | PASS | 空白分类名 → 400 |
| MENU-CAT-07 | PASS | **删含菜品分类 → 409**「This category contains menu items…」 |
| MENU-ITEM-09 | PASS | 建菜品 → 201 |
| MENU-ITEM-03 | PASS | 空名 → 400「Item name is required」 |
| MENU-ITEM-06 | PASS | 负价 → 400「Price must be between 0.01 and 1000000」 |
| MENU-ITEM-05 | PASS | 价 0 → 400（策略:最低 0.01，拒绝免费项） |
| MENU-ITEM-21 | PASS | 同分类重名 → **409** |
| MENU-ALG-08 | PASS | **无麸质 + 过敏原「小麦」未确认 → 409**「dietary labels contradict the allergen information」;带确认标记 → 201 |
| MENU-STOCK-01 | PASS | 上/下架切换 → 200 |
| MENU-STOCK-06 | PASS | 库存 = 0 → **自动售罄** |
| MENU-STOCK-07 | PASS | 库存 = -1 → 400「cannot be negative」 |
| MENU-STOCK-08 | PASS | adjustBy -2 → 5→3（**原子加减**） |
| MENU-STOCK-10 | PASS | adjustBy -10 → **夹到 0 且售罄** |
| MENU-STOCK-11 | PASS | 同传 stockQuantity+adjustBy → 400「either…not both」 |
| MENU-STOCK-12 | PASS | 对未跟踪库存菜品 adjustBy → 400 |
| MENU-STOCK-13 | PASS | 库存 0→5 → 售罄自动解除 |
| MENU-OPT-01 | PASS | 建选项组 → 201 |
| MENU-OPT-04 | PASS | min>max → 400「MinSelections cannot exceed MaxSelections」 |
| MENU-OPT-05 | PASS | 必选组 min=0 → 400「Required groups must have MinSelections >= 1」 |
| **MENU-OPT-02/21** | **FAIL** | **选项组名 `""` 和 `"   "` 被接受(201),且未 trim(存了 `'   '`)——空白/纯空格名校验缺失**（分类/菜品名都会拒绝,选项组名没挡） |
| MENU-ALG-04 | 未确认 | 空过敏原三字段建菜品 → 201;`allergenInfoLastVerifiedAt` 是否为 null 未能经 API 确认（字段名/读取问题），建议浏览器复核 |

## 发现的问题

1. **MENU-OPT-02/21（P0/P1 校验缺失,轻微）**：`POST /api/menu/items/{id}/option-groups` 接受空字符串和纯空格的选项组名(201)且不 trim。预期应像分类/菜品名一样 400 拒绝。
   - 修复位置:选项组创建/更新的名称校验（`MenuOptionGroupController` / 对应 Options 类），补 `Trim()` + 非空校验，与菜品/分类一致。

## 未覆盖(需浏览器逐页,后续接力)
- MENU-PAGE(18):页面目录、选店、搜索、筛选
- MENU-IMG(10):图片上传预签名/完成/校验
- MENU-REC(14)/MENU-PUB(14):排序落库与**顾客端一致性**、审计前后值
- 各组的 Assisted 项(顾客端/小票逐字段对比、并发)
