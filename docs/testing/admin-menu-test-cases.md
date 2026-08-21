# DineFlow Admin Menu 专项测试用例

测试包名称：`admin-menu`  
稳定用例前缀：`MENU-*`  
默认行为：**只保存，不自动执行。** 只有用户明确要求运行 `admin-menu`、某个 `MENU-*` 用例或明确要求 `full` 时才执行。

本测试包覆盖 `/admin/menu`：分类、菜品、价格、供应与售罄、库存与关注、过敏原与膳食标签、选项组与选项（加料/替换）、图片上传、排序与批量操作，以及这些改动在顾客端的呈现。

相邻测试包，不要在本包内重复覆盖：
- Dashboard 上的 Watched menu items 快捷库存 → [dashboard-test-cases.md](dashboard-test-cases.md)
- 顾客下单、购物车与结账 → [full-system-test-cases.md](full-system-test-cases.md)
- 餐厅营业时间与桌台 → [admin-restaurants-test-cases.md](admin-restaurants-test-cases.md)

## 1. 执行与安全规则

- **只在 Local/Test/Staging 执行写操作。** 本包直接改变顾客能点到什么、看到什么价格、以及**过敏原信息**，Production 默认只读。
- **过敏原相关用例最高优先。** 这里的错误不是显示问题，是安全问题：把含麸质的菜标成 gluten free 可能致人入院。任何过敏原用例失败都直接阻断上线结论。
- 测试前记录并在结束时恢复：被改动分类与菜品的全部字段、`DisplayOrder`、选项组与选项、库存与关注状态、以及上传到对象存储的测试图片。
- **删除用例默认使用一次性菜品/分类/选项组。** 不得删除已被历史订单引用的夹具菜品。
- 上传用例只允许上传本轮生成的测试图片，结束后清理对象存储。
- 越权用例必须使用 A/B 两个真实餐厅，并**直接调用 API 复核**。
- 本文件只定义用例；增加或修改用例不会自动开始浏览器操作。

## 2. 端点与授权

菜品与分类控制器是 **AdminApi**；**选项组控制器用的是角色白名单 `PlatformOwner, RestaurantOwner, Admin`**——两套写法要分别验证，尤其确认 Staff 在两边都进不去。

| 端点 | 授权 | 备注 |
|---|---|---|
| `GET/POST/PUT/DELETE /api/admin/menu/items` | AdminApi | 菜品 CRUD |
| `PATCH /items/{id}/availability` | AdminApi | 上下架 |
| `PATCH /items/{id}/sold-out` | AdminApi | 售罄 |
| `PATCH /items/{id}/watch` | AdminApi | 关注 |
| **`PATCH /items/{id}/stock`** | AdminApi | 绝对值设置 **或 `adjustBy` 原子增减** |
| `PATCH /items/bulk-state` | AdminApi | 批量上下架/售罄 |
| `POST /items/reorder` | AdminApi | 拖拽排序 |
| `POST /items/image-upload-url` / `image-upload-complete` | AdminApi | 预签名上传 + **字节校验** |
| `GET /items/watched` | AdminApi | Dashboard 用 |
| `GET/POST/PUT/DELETE /api/admin/menu/categories` | AdminApi | 分类 CRUD |
| `POST /categories/reorder` | AdminApi | 分类排序 |
| `GET/POST/PUT /api/.../option-groups` | **角色白名单** | 选项组 |
| `POST /option-groups/{id}/archive` | 角色白名单 | **归档 ≠ 删除** |
| `DELETE /option-groups/{id}` | 角色白名单 | |
| `.../options` 系列 | 角色白名单 | 选项含 archive 与 delete |

**已知业务约束**（用例预期以此为准）：

- 删除**含菜品的分类**返回 **409**「This category contains menu items. Move or delete those items before deleting the category.」
- 选项组与选项**同时有 archive 和 delete**：归档保留历史订单可读性，删除是硬删。两者语义必须分清。
- 选项的 `AdjustmentType`：**0=Add（加料）、1=Remove（去料）、2=Replace（替换）**。
- 库存 `null` 表示不跟踪（无限量）；`adjustBy` 由数据库原子加减，不接受与 `stockQuantity` 同时传。
- 三个过敏原字段全为空时，`AllergenInfoLastVerifiedAt` 应为 **null**，不得留下"已核验"的假象。

## 3. 推荐夹具

| 夹具 | 最低要求 | 用途 |
|---|---|---|
| PlatformOwner | 唯一 | 跨餐厅 |
| RestaurantOwner / Admin A/B | 分属餐厅 A/B | 越权与主要操作 |
| Staff A | 餐厅 A | **两套授权都应拒绝** |
| 分类 | 至少 3 个，含空分类与满分类 | 排序与删除守卫 |
| 菜品矩阵 | 上架/下架、售罄/正常、跟踪库存/无限量、关注/未关注 | 状态组合 |
| 过敏原矩阵 | 三字段齐全 / 部分 / 全空 | 核验时间戳与顾客端降级 |
| 膳食标签矩阵 | 素/纯素/无麸质/清真各至少一项 | 标签与筛选 |
| 选项组矩阵 | 必选/可选、单选/多选、min<max、已归档 | 选择规则 |
| 选项矩阵 | Add/Remove/Replace 三种类型、正负价差、MaxQuantity>1 | 价格计算 |
| 已被订单引用的菜品 | 历史订单里出现过 | 删除影响 |
| 多币种餐厅 | AUD + 非 AUD | 价格展示 |
| 测试图片 | 真 JPG/PNG/WebP + 伪装成 .jpg 的非图片 | 上传校验 |
| 一次性菜品/分类/选项组 | 每轮新建 | 删除用例 |

## 4. 前置检查（6）

| ID | 优先级 | 前置条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-PRE-01 | P1 | 项目目录 | 记录分支、提交、环境与服务地址 | 明确不是误用生产环境 | Auto |
| MENU-PRE-02 | P1 | 角色账号 | 解析各夹具的角色与 restaurantId | 归属明确 | Auto |
| MENU-PRE-03 | P1 | 数据库 | 导出分类、菜品、选项组的完整基线（含 DisplayOrder） | 后置可精确核对与恢复 | Auto |
| MENU-PRE-04 | P1 | 过敏原基线 | 单独导出三个过敏原字段与核验时间戳 | **过敏原改动必须可逐字段回滚** | Auto |
| MENU-PRE-05 | P1 | 对象存储 | 记录测试前的图片对象列表 | 上传残留可清理 | Auto |
| MENU-PRE-06 | P1 | 一次性夹具 | 生成本轮删除用例专用的菜品/分类/选项组 | 不碰夹具与历史订单引用项 | Auto |

## 5. 页面目录、选店、搜索与筛选（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-PAGE-01 | P1 | 正常网络 | 首次打开 `/admin/menu` | Loading 结束；唯一 H1 为 Menu Management；餐厅与菜单各只请求一次有效数据 | Auto |
| MENU-PAGE-02 | P1 | 当前账号无餐厅 | 打开页面并等待加载 | 显示持久的 No restaurants available 空态；Create/Refresh/Preview 等依赖餐厅的操作不可误用 | Auto |
| MENU-PAGE-03 | P1 | PlatformOwner 有 A/B 两店 | 查看 Restaurant 选择器并切换 A→B | 显示明确的当前店名；分类、菜品、指标和币种全部切到 B | Auto |
| MENU-PAGE-04 | P1 | 合法深链 | 打开 `?restaurant=A&q=milk&categoryStatus=active&itemStatus=live` 并刷新 | 选店、搜索和两类筛选恢复一致；不会先显示其他餐厅数据 | Auto |
| MENU-PAGE-05 | P0 | URL 放入 B/不存在的 restaurant id | A 租户账号直接打开深链 | 不加载 B；安全回退到 A 或拒绝；URL 随有效范围修正且无 B 数据闪现 | Auto |
| MENU-PAGE-06 | P1 | A 有搜索、筛选和已选菜品 | 切换到 B | 清空 A 的搜索、筛选、批量选择与数据；不能把 A 的 id 用于 B 的批量操作 | Auto |
| MENU-PAGE-07 | P1 | 修改搜索/筛选 | 逐项修改、浏览器后退/前进并刷新 | URL 与当前 UI 状态一致；非法枚举值安全回落为 All | Auto |
| MENU-PAGE-08 | P0 | 三类食品风险文字分别只存在于一个字段 | 搜索 `Allergens`、`May contain`、`Cross-contact statement` 的唯一词 | 三类都能命中对应菜品；不得只搜索第一字段而漏掉可能含有/交叉接触 | Auto |
| MENU-PAGE-09 | P1 | 分类/菜品/选项组夹具 | 搜分类名、菜品名、描述、选项组名和选项名 | 均命中正确分类/菜品；大小写和前后空格不影响 | Auto |
| MENU-PAGE-10 | P1 | 已知状态矩阵 | 核对 Categories/Items/Live/Hidden/Sold out/Low stock/Allergens not declared | 数量与完整数据集一致，组合状态不被错误双算为总数 | Auto |
| MENU-PAGE-11 | P1 | 指标卡可点击 | 依次点击 Live/Hidden/Sold out/Low stock/Allergens not declared | 对应筛选激活并带 `aria-pressed`；再次切换结果与 URL 正确 | Auto |
| MENU-PAGE-12 | P1 | 分类状态+菜品状态+搜索 | 组合 active、low-stock 与关键词 | 结果取交集；分类标题命中时仍只展示满足菜品状态的项目 | Auto |
| MENU-PAGE-13 | P1 | 已有活动筛选 | 分别点单个 chip、Clear all 和无结果空态 | 只清相应条件；Clear all 恢复完整菜单；空态解释可恢复方式 | Auto |
| MENU-PAGE-14 | P1 | categories 或 items 单项 500 | 首次加载、Retry、恢复服务 | 成功部分仍可识别但不会伪装完整；错误持久且简短；Retry 后统一恢复 | Auto |
| MENU-PAGE-15 | P1 | Refresh 慢请求 | 单击、快速双击并在加载中再次点击 | Refresh 禁用且无重复写/乱序覆盖；成功只显示一次完整刷新结果 | Auto |
| MENU-PAGE-16 | P1 | Preview | 打开预览、筛选后台列表、关闭再打开 | Preview 明确属于当前餐厅并反映已加载完整菜单；打开/关闭不写数据库 | Auto |
| MENU-PAGE-17 | P1 | 筛选得到 2+ 菜品 | Select matching items、取消一个、Clear selection | 只选择当前可见匹配项；数量准确；隐藏结果和别店菜品不进入集合 | Auto |
| MENU-PAGE-18 | P1 | 已选菜品随后被删除/下架或刷新不再返回 | Refresh 或切店后执行批量动作 | 失效 id 从选择中清除；批量请求不得携带陈旧 id | Auto |

## 6. 路由、角色与租户隔离（14）

| ID | 优先级 | 角色/条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-ROLE-01 | P1 | 未登录 | 打开、刷新、后退 `/admin/menu` | 跳转登录；不闪现菜品或价格 | Auto |
| MENU-ROLE-02 | P1 | Customer | 打开页面并调用管理 API | 页面拒绝；API 403 | Auto |
| MENU-ROLE-03 | P0 | Staff A | 调用菜品 CRUD 与库存端点 | **403**（AdminApi） | Auto |
| MENU-ROLE-04 | P0 | Staff A | 调用选项组端点 | **403**（角色白名单，两套授权都要挡住） | Auto |
| MENU-ROLE-05 | P1 | Admin A | 打开页面 | 只见餐厅 A 的分类与菜品 | Auto |
| MENU-ROLE-06 | P0 | Admin A + B 的菜品 id | GET/PUT/DELETE、availability、sold-out、watch、stock | 全部 403；**B 的菜品字段不变** | Auto |
| MENU-ROLE-07 | P0 | Admin A + B 的分类 id | GET/PUT/DELETE、reorder | 全部 403 | Auto |
| MENU-ROLE-08 | P0 | Admin A + B 的选项组 | 增删改与归档 | 全部 403 | Auto |
| MENU-ROLE-09 | P0 | Admin A | 创建菜品时把 `restaurantId` 填成 B | 拒绝或强制归属 A；**绝不能在 B 下建出菜品** | Auto |
| MENU-ROLE-10 | P0 | Admin A | 把 A 的菜品改到 B 的分类下 | 拒绝；不得跨店挂载 | Auto |
| MENU-ROLE-11 | P0 | Admin A | `bulk-state` 与 `reorder` 混入 B 的 id | **整批拒绝或只作用于 A**；不得部分越权写入 | Auto |
| MENU-ROLE-12 | P1 | 不存在/畸形 id | 各端点传随机 GUID、空串、SQL 片段 | 404/400；无堆栈或 SQL | Auto |
| MENU-ROLE-13 | P1 | 同浏览器切账号 | Admin A → Admin B | 数据按当前身份重算，不残留 | Auto |
| MENU-ROLE-14 | P1 | 图片上传越权 | Admin A 对 B 的菜品发起上传与完成 | 403；不得往别人的存储写 | Auto |

## 7. 分类（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-CAT-01 | P1 | 列表 | 打开分类管理 | 按 DisplayOrder 排序；显示各分类菜品数 | Auto |
| MENU-CAT-02 | P1 | 新建 | 建一个分类 | 成功；出现在列表与顾客端 | Auto |
| MENU-CAT-03 | P1 | 名称校验 | 空白、纯空格、超长、前后空格 | 空白拒绝；超长有上限；存储已 trim | Auto |
| MENU-CAT-04 | P1 | 重名 | 同店建同名分类 | 按策略拒绝或允许，行为一致且提示明确 | Auto |
| MENU-CAT-05 | P1 | 跨店同名 | 在 B 建与 A 同名分类 | 允许；唯一性只在店内 | Auto |
| MENU-CAT-06 | P1 | 编辑 | 改名与改描述 | 成功；顾客端同步 | Auto |
| MENU-CAT-07 | P0 | **删除含菜品的分类** | 对有菜品的分类删除 | **409** 并提示先移动或删除菜品；分类与菜品都不变 | Auto |
| MENU-CAT-08 | P1 | 删除空分类 | 对空分类删除 | 成功；顾客端消失 | Auto |
| MENU-CAT-09 | P1 | 删除后菜品归属 | 先把菜品移走再删分类 | 菜品完好在新分类下 | Auto |
| MENU-CAT-10 | P1 | 排序 | 拖动改变分类顺序 | DisplayOrder 落库；**顾客端顺序一致** | Auto |
| MENU-CAT-11 | P1 | 排序并发 | 两人同时排序 | 结果可解释；不出现顺序错乱或重复序号 | Assisted |
| MENU-CAT-12 | P1 | 排序含非法 id | reorder 传不存在或别店的 id | 拒绝；现有顺序不被破坏 | Auto |
| MENU-CAT-13 | P1 | 空分类顾客端 | 分类下无上架菜品 | 顾客端按策略隐藏或显示空态，不显示空白区块 | Auto |
| MENU-CAT-14 | P1 | 审计 | 建/改/删/排序 | 各有审计记录，含前后值 | Auto |

## 8. 菜品增删改（22）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-ITEM-01 | P1 | 新建表单 | 打开 | 必填项标注清楚；分类下拉只含本店分类 | Auto |
| MENU-ITEM-02 | P1 | 必填校验 | 全部留空提交 | 逐项提示；不发请求 | Auto |
| MENU-ITEM-03 | P1 | 名称 | 空白、纯空格、超长、前后空格、emoji | 空白拒绝；存储已 trim；emoji 不破坏顾客端 | Auto |
| MENU-ITEM-04 | P1 | 描述 | 超长、换行、HTML 片段 | 有上限；HTML 被转义，不在顾客端执行 | Auto |
| MENU-ITEM-05 | P0 | 价格为 0 | 设 0 | 按策略允许（赠品）或拒绝，且**顾客端与小票一致** | Auto |
| MENU-ITEM-06 | P0 | 价格为负 | 设 -1 | **拒绝** | Auto |
| MENU-ITEM-07 | P1 | 价格精度 | 设 9.999、0.005 | 按币种最小单位处理，不出现四舍五入后与收款不符 | Auto |
| MENU-ITEM-08 | P1 | 价格上限 | 设极大值 | 有上限或明确行为；不溢出 | Auto |
| MENU-ITEM-09 | P1 | 分类归属 | 建到指定分类 | 出现在该分类下 | Auto |
| MENU-ITEM-10 | P1 | 移动分类 | 改到另一个分类 | 顾客端随之移动；DisplayOrder 合理 | Auto |
| MENU-ITEM-11 | P1 | 膳食标签 | 逐个切换素/纯素/无麸质/清真 | 落库正确；顾客端标签一致 | Auto |
| MENU-ITEM-12 | P0 | 标签自相矛盾 | 同时勾"纯素"与含肉描述/勾素但不勾纯素 | 按产品规则处理；**纯素必须蕴含素**，不得出现互斥组合 | Auto |
| MENU-ITEM-13 | P1 | 辣度 | 设 0～最大值与越界值 | 越界被拒；顾客端图标与数值一致 | Auto |
| MENU-ITEM-14 | P1 | 份量与热量 | 填写与留空 | 留空时顾客端不显示空标签 | Auto |
| MENU-ITEM-15 | P1 | 推荐/人气 | 切换两个标记 | 顾客端排序或标识随之变化 | Auto |
| MENU-ITEM-16 | P1 | 编辑保存 | 改多个字段后保存 | 全部落库；未改字段不被清空 | Auto |
| MENU-ITEM-17 | P1 | 取消编辑 | 改后取消 | 无写入；重开恢复原值 | Auto |
| MENU-ITEM-18 | P0 | **删除被订单引用的菜品** | 删一个历史订单里出现过的菜品 | 订单历史仍可查、名称与价格来自快照；**不得让订单查询报错** | Auto |
| MENU-ITEM-19 | P1 | 删除一次性菜品 | 删除 | 从管理端与顾客端消失 | Auto |
| MENU-ITEM-20 | P1 | 审计 | 建/改/删 | 有审计与前后值 | Auto |
| MENU-ITEM-21 | P1 | 同分类重名 | 在同一分类以大小写/前后空格变体创建同名菜品 | 409；不得产生视觉重复菜品 | Auto |
| MENU-ITEM-22 | P2 | 跨分类同名 | 在另一分类创建同名菜品 | 按明确的“分类内唯一”策略允许或拒绝；管理端、搜索和顾客端行为一致 | Auto |

## 9. 供应状态、售罄、库存与关注（18）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-STOCK-01 | P1 | 上架/下架 | 切换 availability | 下架后顾客端不可见/不可点 | Auto |
| MENU-STOCK-02 | P1 | 售罄 | 切换 sold-out | 顾客端显示售罄且不可加入购物车 | Auto |
| MENU-STOCK-03 | P1 | 下架 vs 售罄 | 两者组合 | 语义不同：下架是不卖了，售罄是今天没有；顾客端表达不同 | Auto |
| MENU-STOCK-04 | P1 | 无限量 | 库存设 null | 显示不跟踪；不受库存影响 | Auto |
| MENU-STOCK-05 | P1 | 设定库存 | 设为具体数字 | 落库；顾客端剩余量表现符合产品规则 | Auto |
| MENU-STOCK-06 | P0 | 库存为 0 | 设为 0 | **自动标记售罄**；顾客端不可下单 | Auto |
| MENU-STOCK-07 | P1 | 负库存 | 设为 -1 | 拒绝 | Auto |
| MENU-STOCK-08 | P0 | **原子增减** | 用 `adjustBy` 加减 | 由数据库对当前值加减，不是客户端算好的绝对值 | Auto |
| MENU-STOCK-09 | P0 | **并发增减** | 两人同时各减 1 | **最终减 2**，不丢更新；两个请求都不谎报成功 | Assisted |
| MENU-STOCK-10 | P1 | 减到 0 以下 | `adjustBy` 使结果为负 | 夹到 0；同时标记售罄 | Auto |
| MENU-STOCK-11 | P1 | 参数互斥 | 同时传 `stockQuantity` 与 `adjustBy` | **拒绝**并说明只能二选一 | Auto |
| MENU-STOCK-12 | P1 | 对无限量菜品增减 | 对 null 库存用 `adjustBy` | 拒绝并说明该菜品不跟踪库存 | Auto |
| MENU-STOCK-13 | P1 | 售罄与库存一致 | 库存从 0 加回正数 | 售罄标记自动解除 | Auto |
| MENU-STOCK-14 | P1 | 关注 | 切换 watch | 出现在 Dashboard 的 Watched 组件 | Auto |
| MENU-STOCK-15 | P1 | 取消关注 | 再次切换 | 从 Watched 组件消失 | Auto |
| MENU-STOCK-16 | P1 | 批量状态 | `bulk-state` 批量上下架/售罄 | 全部生效；部分失败逐条报告 | Auto |
| MENU-STOCK-17 | P0 | 批量越权 | 批量列表混入别店 id | **整批拒绝或只作用于本店**；不得部分越权 | Auto |
| MENU-STOCK-18 | P1 | 审计 | 库存与状态变更 | 有审计与前后值；批量逐条记录 | Auto |

## 10. 过敏原与膳食安全（16）

> **本组任何一条失败都直接阻断上线结论。** 这里的错误会让人进医院。

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-ALG-01 | P0 | 填写过敏原 | 填 `Allergens` | 顾客端在下单前可见，不需要展开或滚动才能发现 | Auto |
| MENU-ALG-02 | P0 | 可能含有 | 填 `MayContainAllergens` | 与"确定含有"**视觉与措辞都要区分**，不能混为一谈 | Auto |
| MENU-ALG-03 | P0 | 交叉接触声明 | 填 `CrossContactStatement` | 顾客端完整显示，不被截断 | Auto |
| MENU-ALG-04 | P0 | **三字段全空** | 清空三个字段 | `AllergenInfoLastVerifiedAt` **必须为 null**；顾客端诚实显示"未提供过敏原信息"，**不得显示"已核验"** | Auto |
| MENU-ALG-05 | P0 | 部分填写 | 只填其中一个 | 核验时间戳有值；顾客端只展示已填写的部分，不推断其余 | Auto |
| MENU-ALG-06 | P0 | 时间戳保留 | 改其他字段但不动过敏原 | **核验时间戳不变**，不得被无关编辑刷新 | Auto |
| MENU-ALG-07 | P0 | 时间戳更新 | 修改任一过敏原字段 | 时间戳更新为当前时间 | Auto |
| MENU-ALG-08 | P0 | 无麸质标签 vs 过敏原 | 勾 gluten free 同时过敏原写"小麦" | **必须阻止或强制提示**，不得静默保存自相矛盾的信息 | Auto |
| MENU-ALG-09 | P0 | 纯素标签 vs 过敏原 | 勾 vegan 同时过敏原写"牛奶/鸡蛋" | 同上 | Auto |
| MENU-ALG-10 | P1 | 长度与格式 | 超长、换行、逗号分隔、中英混排 | 有上限；顾客端可读不溢出 | Auto |
| MENU-ALG-11 | P1 | HTML 注入 | 过敏原字段填 `<script>` | 转义显示；不执行 | Auto |
| MENU-ALG-12 | P0 | 选项对过敏原的影响 | 加料含花生的选项 | 顾客选中后**过敏原提示随之更新**，不只看主菜品 | Assisted |
| MENU-ALG-13 | P0 | 顾客端一致性 | 逐字段对比管理端与顾客端 | 完全一致，无省略、无改写 | Assisted |
| MENU-ALG-14 | P0 | 小票一致性 | 对比顾客端与打印小票 | 过敏原信息一致；不因排版被截断 | Assisted |
| MENU-ALG-15 | P1 | 历史订单 | 改过敏原后查旧订单 | 旧订单显示下单当时的快照，不被追溯改写 | Auto |
| MENU-ALG-16 | P1 | 审计 | 过敏原变更 | **必须有审计**，含前后值与操作者 | Auto |

## 11. 选项组与选项（24）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-OPT-01 | P1 | 新建组 | 建一个可选单选组 | 成功；顾客端出现 | Auto |
| MENU-OPT-02 | P1 | 名称校验 | 空白、超长、前后空格 | 空白拒绝；已 trim | Auto |
| MENU-OPT-03 | P0 | 必选组 | 设 IsRequired | **顾客不选则无法加入购物车** | Assisted |
| MENU-OPT-04 | P0 | min/max 校验 | min>max、负数、max=0 | **拒绝**；不得存出无法满足的规则 | Auto |
| MENU-OPT-05 | P0 | 必选但 min=0 | IsRequired 且 min=0 | 拒绝或明确定义；不得出现"必选却可不选" | Auto |
| MENU-OPT-06 | P1 | 单选 | max=1 | 顾客端为单选控件；选第二个替换第一个 | Assisted |
| MENU-OPT-07 | P1 | 多选 | max>1 | 顾客端可多选；达到上限后其余禁用 | Assisted |
| MENU-OPT-08 | P1 | 新建选项 | 建 Add 类型、正价差 | 顾客端加价正确 | Auto |
| MENU-OPT-09 | P1 | Remove 类型 | 建 Remove 类型（去料） | 顾客端表达为"去掉"；价格按规则 | Auto |
| MENU-OPT-10 | P1 | Replace 类型 | 建 Replace 类型 | 顾客端表达为"替换"；与 Add 区分 | Auto |
| MENU-OPT-11 | P0 | 负价差 | 价差为负 | 按策略允许（折扣）或拒绝；**行合计不得为负** | Auto |
| MENU-OPT-12 | P0 | MaxQuantity>1 | 单个选项可选多份 | 数量上限生效；**价格 = 单价 × 数量**，不多不少 | Auto |
| MENU-OPT-13 | P0 | 价格计算 | 主菜 + 多个加料 + 多份 | 行合计与后端一致；**顾客端、购物车、订单、小票四处相同** | Assisted |
| MENU-OPT-14 | P1 | 排序 | 组与选项各自排序 | 顺序落库且顾客端一致 | Auto |
| MENU-OPT-15 | P0 | **归档组** | 归档一个已被历史订单使用的组 | 新订单不再可选；**历史订单仍能正确显示该选项** | Auto |
| MENU-OPT-16 | P0 | **删除组** | 硬删一个组 | 与归档语义区分清楚；若会破坏历史订单则应拒绝或改为归档 | Auto |
| MENU-OPT-17 | P1 | 归档选项 | 归档单个选项 | 同 MENU-OPT-15，粒度到选项 | Auto |
| MENU-OPT-18 | P1 | 删除选项 | 硬删单个选项 | 同 MENU-OPT-16 | Auto |
| MENU-OPT-19 | P1 | 空组 | 组内没有任何选项 | 顾客端不显示空组；必选空组必须被阻止 | Auto |
| MENU-OPT-20 | P1 | 审计 | 组与选项的增删改归档 | 各有审计与前后值 | Auto |
| MENU-OPT-21 | P0 | 绕过 UI 的名称输入 | API 提交空白、纯空格和超长 group/option name | 后端 400；不得存入空白或超长顾客选项 | Auto |
| MENU-OPT-22 | P0 | 非法 AdjustmentType | API 提交 -1、3、99 | 后端 400；不得把未定义枚举写入数据库或价格计算 | Auto |
| MENU-OPT-23 | P1 | MaxQuantity API 边界 | 绕过 UI 提交 0、101 和极大整数 | 0 与超过产品上限的值均拒绝；不得只在前端限制 100 | Auto |
| MENU-OPT-24 | P1 | selection API 边界 | 绕过 UI 提交 min/max=101、极大整数及不可满足组合 | 后端与 UI 同样限制 0～100；不能保存永远无法完成的必选组 | Auto |

## 12. 图片上传（10）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-IMG-01 | P1 | 正常上传 | 上传真 JPG/PNG/WebP 各一张 | 成功；顾客端正确显示 | Assisted |
| MENU-IMG-02 | P0 | **伪装文件** | 把 HTML/脚本改名为 `.jpg` 并声明 `image/jpeg` 上传 | **拒绝**；对象不得留在存储里 | Auto |
| MENU-IMG-03 | P0 | 声明与实际不符 | 上传真 PNG 但声明 `image/jpeg` | 拒绝 | Auto |
| MENU-IMG-04 | P0 | SVG | 上传含脚本的 SVG | 拒绝（不在允许类型内） | Auto |
| MENU-IMG-05 | P1 | 超大文件 | 超过上限 | 拒绝并提示上限 | Auto |
| MENU-IMG-06 | P1 | 空文件/截断文件 | 0 字节与只有几字节 | 拒绝，不崩 | Auto |
| MENU-IMG-07 | P1 | 未完成即引用 | 只调 upload-url 不调 complete | 菜品不引用未验证对象 | Auto |
| MENU-IMG-08 | P1 | 替换图片 | 换一张新图 | 旧图按策略清理或保留；顾客端更新 | Auto |
| MENU-IMG-09 | P1 | 无图 | 不设图片 | 顾客端显示占位，不是坏图标 | Auto |
| MENU-IMG-10 | P1 | 清理 | 结束后核对存储 | 本轮测试对象已清理 | Auto |

## 13. 排序、批量与顾客端一致性（14）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-PUB-01 | P0 | 上架变更 | 下架一个菜品后立刻看顾客端 | 顾客端不可见/不可点，**不得仍能加入购物车** | Auto |
| MENU-PUB-02 | P0 | 售罄变更 | 标记售罄后看顾客端 | 显示售罄且不可下单 | Auto |
| MENU-PUB-03 | P0 | 价格变更 | 改价后看顾客端与购物车 | 新价生效；**已在购物车中的旧价按产品规则处理且不得静默变价** | Assisted |
| MENU-PUB-04 | P0 | 删除菜品 | 删除后顾客端仍打开着旧页面 | 下单时被明确拒绝，不产生指向已删菜品的订单 | Assisted |
| MENU-PUB-05 | P1 | 排序一致 | 改分类与菜品顺序 | 顾客端顺序与管理端一致 | Auto |
| MENU-PUB-06 | P1 | 币种 | 非 AUD 餐厅 | 顾客端用该店币种，不借用别店 | Auto |
| MENU-PUB-07 | P1 | 搜索 | 顾客端搜索菜品 | 命中正确；**搜 `%` 或 `_` 按字面匹配** | Auto |
| MENU-PUB-08 | P1 | 下架菜品不可搜到 | 搜已下架菜品 | 不出现在顾客端结果 | Auto |
| MENU-PUB-09 | P1 | 菜品排序 | reorder 后刷新 | DisplayOrder 落库且稳定，翻页不乱 | Auto |
| MENU-PUB-10 | P1 | reorder 非法输入 | 传重复 id、缺 id、别店 id | 拒绝；现有顺序不被破坏 | Auto |
| MENU-PUB-11 | P1 | 批量含无效 id | bulk-state 中一个 id 无效 | 原子拒绝且全部不变，或逐条报告每项结果；不得静默部分成功或谎报全成功 | Auto |
| MENU-PUB-12 | P1 | 缓存 | 改动后顾客端强制刷新与软刷新 | 都能看到最新，或有明确的缓存说明 | Assisted |
| MENU-PUB-13 | P1 | 餐厅打烊 | 打烊时看菜单 | 可浏览但不可下单，提示明确 | Auto |
| MENU-PUB-14 | P1 | 餐厅停用 | 餐厅 isActive=false | 顾客端不可访问该菜单 | Auto |

## 14. 并发、恢复、无障碍与响应式（12）

| ID | 优先级 | 条件 | 操作步骤 | 预期 | 类型 |
|---|---|---|---|---|---|
| MENU-REC-01 | P1 | 两名管理员 | 同时编辑同一菜品并先后保存 | 结果可解释；**不得静默丢失一方的全部修改** | Assisted |
| MENU-REC-02 | P0 | 并发库存 | 见 MENU-STOCK-09 | 不丢更新 | Assisted |
| MENU-REC-03 | P1 | 并发排序 | 两人同时拖动排序 | 顺序自洽，无重复或空缺序号 | Assisted |
| MENU-REC-04 | P1 | 请求中断 | 保存/删除/上传时刷新或断网 | 以服务器为准；无假成功或重复写入 | Auto |
| MENU-REC-05 | P1 | API 401/403/429/500 | 覆盖各操作的错误呈现 | 短消息可重试；不显示 SQL、堆栈或存储密钥 | Auto |
| MENU-REC-06 | P1 | 会话过期 | 停留后保存 | 引导重新登录；表单内容不无声丢失 | Assisted |
| MENU-REC-07 | P1 | 页面语义 | 检查 H1、分区、表单分组、Dialog | 唯一 H1；分组有名称 | Auto/Assisted |
| MENU-REC-08 | P1 | 控件命名 | 上下架、售罄、关注、库存加减、删除 | 每个都有可读名称，**不只靠图标或颜色** | Auto |
| MENU-REC-09 | P1 | 纯键盘 | 建分类→建菜品→设过敏原→配选项→排序 | 焦点顺序合理可见、无陷阱；拖拽有键盘替代 | Assisted |
| MENU-REC-10 | P2 | 屏幕阅读器 | 读取菜品状态、过敏原、选项规则 | 过敏原信息**必须可被读出**，不能只有视觉标记 | Assisted |
| MENU-REC-11 | P1 | 手机/平板/200% zoom | 浏览与编辑 | 无横向溢出；过敏原文本不被截断 | Assisted |
| MENU-REC-12 | P1 | 测试结束 | 核对数据库、对象存储与顾客端 | 分类/菜品/选项/库存/过敏原全部恢复；测试图片已清理 | Auto |

## 15. 推荐执行顺序

1. `MENU-PRE-*`，特别是过敏原字段的独立基线。
2. `MENU-PAGE-*` 与 `MENU-ROLE-*`，先确认页面范围并把两套授权（AdminApi 与角色白名单）都钉死。
3. 只读的分类与菜品列表、搜索、筛选、指标和 Preview。
4. `MENU-CAT-*`、`MENU-ITEM-*`，用一次性夹具。
5. **`MENU-ALG-*` 单独一轮，逐字段核对管理端 / 顾客端 / 小票三处**，不要和其他组混着跑。
6. `MENU-STOCK-*`、`MENU-OPT-*`。
7. `MENU-IMG-*`，结束即清理对象存储。
8. `MENU-PUB-*` 顾客端一致性。
9. 并发、无障碍、响应式与最终清理。

## 16. 用户接力

| 场景 | 用户操作 | Agent 后续验证 |
|---|---|---|
| 过敏原核对 | 在手机上打开一个菜品，念出看到的过敏原文字 | 与数据库逐字比对，确认无省略或改写 |
| 小票 | 打印一张含过敏原菜品的小票 | 与顾客端一致、未被截断 |
| 加料价格 | 下一单含多个加料且某加料选 2 份 | 行合计与后端计算一致 |
| 必选组 | 不选必选项尝试加入购物车 | 确认被阻止 |
| 图片 | 上传一张真实照片 | 顾客端显示正常、比例正确 |
| 并发库存 | 两台设备同时点减库存 | 最终值不丢更新 |
| 屏幕阅读器 | 用 VoiceOver 读一个含过敏原的菜品 | 过敏原被完整读出 |

## 17. 完成标准

- 所有被选 `MENU-*` 都记录为 PASS/FAIL/BLOCKED/NOT RUN；部分观察不能冒充 PASS。
- **`MENU-ALG-*` 任何一条失败即阻断上线结论**，不接受"低概率""稍后修"。
- 其余 P0 任一失败同样阻断：跨租户读写、Staff 越权、批量部分越权、库存并发丢更新、价格为负、必选组规则无法满足、伪装文件通过上传、下架/售罄后顾客仍能下单。
- 每个写操作在数据库、管理端、顾客端三处一致，并完成恢复。
- 对象存储无本轮测试残留。
- 本包通过不代表顾客下单、支付、打印或完整 release/full 验收通过。
