# 本机 MCP 契约与实测证据

2026-10-14，Node 24，官方端点 `https://mcp.mcd.cn`。SDK 完成握手和 tools/list，两个门店查询均成功。SDK 负责 Streamable HTTP / SSE 协议解析。凭据仅从忽略的 `.env.local` 中的 `MCD_MCP_TOKEN` 进入运行时；公开材料不包含请求头、账号、traceId 或完整原始响应。

## 工具边界

`createGateway(token)` 返回经 `guardGateway` 包装的 `McpGateway`。白名单在任何 SDK 请求前执行；不允许的工具连 tools/list 都不会触发。随后由 Ajv 按本轮 tools/list 的 inputSchema 校验参数，调用返回解析后的业务对象，保留 `.data`。连接、请求、关闭均有 15 秒期限；关闭会结束 SDK 连接。SDK tools/list 的 `nextCursor` 被完整遍历，并拒绝重复游标。

| 允许工具 | 实际 inputSchema 必填项 | 其他实际参数 |
| --- | --- | --- |
| query-nearby-stores | beType, searchType | city, keyword；beType 为 1/5，searchType 为 1/2 |
| query-meals | storeCode, orderType, beType | beCode, reservationDate |
| query-meal-detail | storeCode, orderType, beType, code | beCode, reservationDate |
| list-nutrition-foods | 无 | 无 |
| calculate-price | storeCode, orderType, beType | items, beCode, reservationDate, needTableware, gmServiceCode, withOrder |
| now-time-info | 无 | 无 |

到店自提使用 `beType: 1, orderType: 1`，不传 beCode。门店按位置搜索使用 `searchType: 2`；`searchType: 1` 是收藏餐厅。其余渠道的参数组合以实际 schema 描述为准，本轮验证的是到店自提。创建订单、支付、优惠券绑定、积分和抽奖工具不在白名单。HTTP 只提供 `/api/stores`、`/api/catalog`、`/api/quote` 三个标准化接口。

## 门店查询

执行了 `npm run mcp:probe -- --city 杭州 --keyword 凤起路`；实际返回以下五个候选，没有自动选店。

| storeId | 官方餐厅名 | 官方地址 |
| --- | --- | --- |
| 3330489 | 麦当劳杭州拱墅区茶叶大厦餐厅 | 延安路310号茶叶大厦 |
| 3330387 | 麦当劳杭州国大城市广场餐厅 | 延安路609号B2层B234麦当劳铺位 |
| 3330412 | 麦当劳杭州湖滨路餐厅 | 湖滨路39号华侨饭店3号楼一楼101室麦当劳 |
| 3330120 | 麦当劳杭州庆春路餐厅 | 中山中路558号一层 |
| 3330658 | 麦当劳杭州上城区工联大厦餐厅 | 学士路31号工联大厦201室 |

用户随后明确地址“建国北路 286 号”。执行了 `npm run mcp:probe -- --city 杭州 --keyword 建国北路286号`，返回仍包含五个周边候选，其中唯一地址完全匹配的是：`3330251`，**麦当劳杭州下城区-凤起路农贸市场餐厅**，地址 **杭州建国北路286号**。该编码由用户地址和官方实测共同确定。官方旧行政区名称照原文保留。两次查询均通过 `beType: 1` 验证到店自提；响应没有完整渠道列表，不能推断其他渠道支持情况。

实际门店字段包括 `storeCode/storeName/address/distance/businessStatus/businessStartTime/businessEndTime/longitude/latitude/reservation/reservationTimeOptions`。当前 StoreOption 仅映射公开 `storeCode → id`、`storeName → name`、`address`，城市来自查询上下文；不要猜测其他编码。

## 菜单、身份、详情、营养

主任务对已确认门店 `3330251` 做了本轮只读补充探测，以下是审查后的字段证据。原始处理文件均留在忽略的 `.private/`。

- query-meals：业务响应 `success: true, code: 200`，data 为对象，含 `categories/meals/frequent`。实测 14 个分类、109 个编码映射项；分类为 `name + meals[{code,tags}]`，`data.meals` 为商品编码到详情的映射。现有 inputSchema 无 page/cursor 参数，响应无分页或 complete 字段。仅在分类引用均能在映射中解析、结果通过结构检查时可声明本次返回已完整装载；这不代表其他门店或时间菜单相同。
- 商品身份：分类餐品的 `code` 对应 `data.meals[code]`；详情映射包含 `name/image/currentPrice/originalPrice/canWithOrder/withOrder`。图片使用官方 image。价格为字符串；规格不能只凭同名商品合并。`frequent` 是账户相关派生内容，公开 fixtures 不保存它。
- 单品详情 `1100`：实际 data 包含 `code/name/rounds/image/modification/supportModify`，rounds 为空；`modification.items` 中有 `minValues/maxValues/values`。values 包含 `code/name/price/minQuantity/maxQuantity/selectedQuantity/selectedKey/unselectedKey`。
- 套餐详情 `9900004236`：rounds 共四轮，轮次 ID 1–4，包含 `minQuantity/maxQuantity/quantity/choices`。choice 包含 `code/name/quantity/maxQuantity/isDefault/diffPrice/supportModify/modification`；套餐子项需要按轮次结构处理，不能直接按普通单品核价。
- 特制参数：选中项使用 `selectedKey`；未选中项若有非空 `unselectedKey`，仍须传入该项，使用 unselectedKey。详情中缺少必要字段时应停止核价或拒绝支持，不能猜值。
- list-nutrition-foods：`success: true, code: 200`，data 是 TOON 文本字符串，不是 JSON 数组。首行声明 160 行；CSV 数据有 `productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium`。必须正确处理 CSV 引号与单位，不按名称猜营养值，也不把未匹配当作零。

## 核价字段与单位

calculate-price 的 items 结构声明 `productCode/quantity/modification/roundList`，单品与套餐使用不同组合结构；产品字段虽然在 schema 的嵌套 required 中未全部约束，描述明确要求商品编码、数量 >= 1，业务 adapter 还须检查数量、上下文、选项和商品身份。

本轮主任务允许的单品核价为 `1100 × 1`，到店自提、无优惠券、无餐具、无订单操作。实测 `productOriginalPrice/productPrice/originalPrice/price` 都是 **2650**，`discount: 0`，productList 中 subtotal 为 **2650**；菜单 currentPrice 是 **26.5**，由此交叉验证该商品菜单价是元、核价是分。outputSchema 明确标注 `price/productPrice/originalPrice/discount/productList.subtotal/deliveryPrice/packingPrice/tablewarePrice` 等核价金额字段单位为分。不要将报价的整数再次乘 100。

实测返回 `productList` 和 `takeWayList`，本次没有费用字段，不能据此断言其他上下文费用为零。`price` 是官方最终报价；费用字段如存在应单独展示，避免加到已含费用的 price 上。`enjoyed/enjoyable.realDiscount` 的 schema 注释另标为元，不能与以分计的 discount 混用。没有创建订单或支付。

## 错误与本机接口

- SDK envelope 的 `isError: true`，或解析后的业务对象 `success: false`，统一拒绝为 `MCP_TOOL_FAILED`；本轮成功对象均为 `success: true, code: 200`。优先读 structuredContent，缺少时仅解析 text 内容中的 JSON；畸形或非对象响应拒绝为 `MCP_INVALID_RESPONSE`。
- HTTP 401、429、超时分别转为公开 `MCP_UNAUTHORIZED/MCP_RATE_LIMITED/MCP_TIMEOUT`；未知上游错误只暴露稳定代码。正文不传递原始 error.message、cause、账号或响应内容。
- Fastify 不启用原始请求日志，监听仅 `127.0.0.1:8787`。Host 必须为该地址；Origin 只接受 `http://127.0.0.1:5173` 和本机 API 同源地址。POST 必须有允许的 Origin，拒绝跨站 Sec-Fetch-Site。没有 CORS 放行或任意 MCP 转发接口。
- quote JSON 限制 64 KiB、1–50 行、每行数量 1–99、最多 30 个不同选项，拒绝额外字段、负 revision、空字符串。stores/catalog 查询也拒绝缺失或额外字段。
- `createApp(ApiServices)` 是可注入的工厂。Task 4 的 `server/main.ts` 导出 `createRuntimeServices()` 与 `startServer(services, onClose?)`，直接启动已接通 stores/catalog；gateway 仅在业务请求发生时连接。quote 在 Task 5 接入前明确返回 QUOTE_NOT_READY / 503。

## 证据保存与验证

SDK 实测 schemas：`.private/probe-tools-schema.json`。脱敏门店 fixture：`.private/probe-store-fixture.json`。两次探测的输出日志：`.private/task-3-probe-fengqi.log`、`.private/task-3-probe-jianguo.log`。这些文件均被 Git 忽略。共享原始 outputSchema 来自主任务本轮 `.private/root-tools-schema.json`；公开文档只记录必要的字段和单位。

`tests/mcp.test.ts` 与 `tests/http.test.ts` 覆盖白名单、schema、错误对象脱敏、业务失败、畸形响应、Origin/Host/跨站 metadata、严格载荷与真实 loopback TCP 请求。验证包含 Node 24 全量测试与 TypeScript noEmit。


## Task 4 标准化菜单与规格

`server/mcp/catalog.ts` 导出 `createCatalogService(gatewayOrLazyFactory)`，提供 `searchStores({city,keyword})`、`loadCatalog({storeId,diningMode})`、`getContext(contextKey)`、`getDetail(contextKey,officialCode)`。仅支持 `pickup`；未确认的门店须先由门店搜索返回，用户已明确确认的 `3330251` 作为可直接加载的初始门店。没有时段推测或自动停售筛除。

Task 6 将每次加载的随机 contextKey 改为标准化公开菜单语义及门店/自提渠道的稳定 SHA-256 标识；价格、商品/规格身份、分类或营养变化会改变标识，loadedAt、上游trace及凭据字段不进入内容种子。刷新后本人明确加载相同菜单，暂存赛程可以继续，候选与决定仍完整校验。相同内容刷新loadedAt及详情缓存，不绕过核价请求generation。上下文保留 `snapshot/store/diningMode/orderType/beType/rawMeals/candidates/variants`；后三者为只读 Map。原始商品数据仅在服务端；不把 withOrder 会员字段传到前端。contexts 最多保留 20 个，`getContext` 对未知或已淘汰上下文返回 undefined。`getDetail` 仅可查询当前上下文的菜单编码或已确认 variant 编码，并缓存同一上下文的成功详情；失败缓存删除以允许明确重试。

公开 `Candidate` 保留原字段并增加可选 `stageLabel/sourceCategories/variants/defaultVariantId`，`sourceCategory/sourceCategories` 保留官方原分类，stageLabel 为呈现的有内容赛区名。`CatalogSnapshot.rawSkuCount` 表示当次菜单编码数量，items.length 表示擂台候选数。候选覆盖全部编码，没有 Top-N；当前 schema 无商品分页参数，当分类引用与编码映射不一致、结构缺失或无法确认完整时 `complete=false`，UI 与 startSession 均阻止开赛。

`Variant` 字段为 `id/officialCode/name/sizeLabel/referencePriceCents/nutrition/imageUrl/menuCode?/roundId?`。只归并明确大小杯尺寸、且基础产品名一致的饮料；含糖/无糖、口味和冷热区别保留。菜单已有直接尺寸 SKU 时 menuCode 等于 officialCode，无 roundId。可乐菜单编码 `9900008751` 的详情选择轮次 1 含六个 SKU，标准与无糖分别形成一个候选，各自保留三种尺寸。Variant ID 如 `live:sku:9900008751:3050`，menuCode 为 `9900008751`、roundId 为 1、officialCode 为 `3050`；其中 parent menuCode 与 roundId 供下一任务按真实 schema 组装 roundList，不能把 family ID 当商品编码。

Task 5 的规格选择沿用 BasketLine.optionIds：`variant:<variant.id>`。必须通过 context.candidates 与 context.variants 验证该规格确实属于候选，再通过对应详情验证其选择编码。Task 4 不生成核价 payload，也不调用 calculate-price。菜单参考价采用实际 currentPrice（元）或已确认详情 diffPrice（元）；带 canWithOrder 的项目明确标记条件价，正式核价仍以 Task 5 的官方结果为准。

营养 TOON 声明行数、CSV 引号与字段数量均核对；仅在产品名经过 Unicode NFKC/空白规范化，以及明确大小杯尺寸括号规范化后完全一致时匹配。冲突重复记录、缺值或未匹配保持未知；不推导套餐营养、不用部分名称猜测。Arena 卡片逐规格展示参考价及所有已知营养值。

实际 fixture 保留本轮较早返回的 14 个原分类、109 个菜单身份；详情展开为 110 候选。随后 Task 4 经本机 API 工厂进行新一轮真实 MCP 验证：门店 `3330251` 返回 111 个菜单身份、112 候选、8 个非空赛区、18 个规格映射，111 个身份全部可达且 complete=true。数量由官方实时返回变化，fixture 与实时状态分别记录，不硬锁旧数量。较早 fixture 不含 frequent 或任何账户/请求头数据。

启动使用 Node 24：`PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm --userconfig=/dev/null run dev:api`。Vite dev:web 固定 127.0.0.1:5173，/api 代理到 127.0.0.1:8787 并启用 changeOrigin，符合本机 Host 限制。凭据仅由运行时 --env-file-if-exists=.env.local 读取，不进入浏览器。

## Task 5 餐盘与官方核价

`server/mcp/quote.ts` 导出 `createQuoteService(catalog, gatewayOrLazyFactory)`，返回 `quoteBasket(QuoteRequest)` 和 `selection(QuoteRequest)`。main.ts 接入与目录查询相同的 CatalogService 与懒加载 gateway。初始化页面和样例不调用 MCP；结果页进入真实餐盘后按需确认实际默认选配，calculate-price 仅由“获取官方整单报价”发起。

标准餐盘仍为 `{candidateId,quantity,optionIds}`；杯型使用 `variant:<variant.id>`。整盘的 context、候选、1–99 整数数量、重复候选与规格归属先全部核对，再读取详情。实际 menuCode 必须存在于当前 rawMeals。规格同时属于候选与 context.variants，详情的真实 round/choice 也须支持该 SKU；无糖规格无法冒充普通可乐。不存在或失效的商品、规格、上下文拒绝，不猜替代餐品。

可乐中杯采用 `items:[{productCode:'9900008751',quantity:1,roundList:[{round:'1',comboItemList:[{code:'3050',quantity:1}]}]}]`。大杯 child code 为 3100；直接规格 SKU 3010 保持普通商品结构。套餐使用详情中实际正数量默认选择，核对轮次 minQuantity/maxQuantity/quantity 与 choice.maxQuantity，输出同样的 round/ comboItemList 结构。不能确定完整默认内容时返回 SELECTION_REQUIRED，界面明示待选配并阻止核价，不虚构默认选择。当前支持实际杯型和官方默认套餐内容，不提供套餐换料或成分特制编辑。

新增窄接口 `POST /api/selection`，请求 schema 与 /api/quote 相同，只返回 `{candidateId,components:[{name,quantity}],requiresSelection}` 列表。它沿用同一 Host、Origin、Sec-Fetch-Site、payload 和业务上下文校验，不接受工具名、凭据、原始参数或账户字段。它只读详情，不调用 calculate-price。旧的“三个接口”说明应以这四个规范接口为准；仍无任意 MCP 转发。

quote 只接受 `success:true,code:200,data.price` 的有效非负安全整数。price 单位按已核实字段证据固定为分，不猜大小、不给缺价填零、不自行累计菜单参考价。仅提取 deliveryPrice/packingPrice/tablewarePrice 中明确存在且有效的分金额；缺少费用明细保持未知，费用不再次叠加到官方 price。失败、MCP isError、业务失败、缺价或畸形金额显示未取得报价。

每次餐盘变化清空有效报价并递增 revision。客户端 tracker 同时检查 contextKey、规范 basketKey、cartRevision 与独立请求 generation；离开页面也取消 generation，晚到的成功或失败均不能恢复旧价格，即使后来再次出现相同 context/revision。重选其他赛区保留未改变冠军的实际规格和数量，已删除餐品不自动回填。复制和下载餐单仅含公开商品名、数量、实际规格/默认子项、门店、来源和核价时间；没有订单创建。

本轮新的运行时注入实测通过：可乐中杯 1000 分、大杯 1200 分、大杯两份 2400 分、巨无霸 2650 分、四件套实际四轮默认内容 5700 分，均返回 official。报价差异以官方返回为准。脱敏证据 `.private/task5-live-evidence.json` 和 `.private/task5-live-probe.log`；公开 `tests/fixtures/quote.json` 只保存必要商品与报价字段，费用/失败/缺价为明确测试案例。
