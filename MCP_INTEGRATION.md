# 麦麦二选一的 MCP 接入

本项目使用麦当劳官方 MCP Server `https://mcp.mcd.cn`，本机 Node.js 服务通过 `@modelcontextprotocol/sdk` 的 Streamable HTTP 客户端连接。用户在自己的电脑上启动账号版，输入本人 Token，读取实时菜单和本人券包、核对官方整单金额。公网 GitHub Pages 只提供有采集时间的门店快照。

## 从菜单到订单确认

1. **Menu**：连接本人账号后，服务端查询所选门店、在售菜单、必要商品详情及营养。保留商品编码、真实口味、杯型、定制和未知值。各账号的菜单、券包和报价由独立会话管理。
2. **PK**：用户自选多分类与候选，拖动调整分类顺序。每轮随机抽两份存活候选，胜者留池、败者淘汰，再重新随机抽取；N份候选经N−1次选择留下最后一份。可以点整张卡或用硬币决定；这个过程在前端执行，不调用 MCP。食品实际口味分别参与，饮料同味杯型在最后餐盘选择。
3. **Basket 与本人券**：各分类选择组成餐盘，可调整数量、杯型和定制。读取本人券和当前门店券，以券的两项官方身份确认本人持有且当前门店适用。推荐按真实餐品编码及数量匹配，显示覆盖比例、额外餐品和定制差异；用户可替换或撤销。原套餐保持整份，缺少必选项或未确认详情时不猜参数。
4. **calculate-price**：用户主动获取报价时，按真实编码、数量、套餐轮次、定制及适用券发送整个餐盘。金额取官方 `data.price`，单位为分，同时核对返回商品数量及可选取餐方式。缺失费用保持未知；餐盘修改、报价过期或刷新会让旧报价与用券价差失效，晚到响应不会恢复旧金额。
5. **用户确认订单**：代码支持用户明确确认最新报价及官方取餐方式后创建待支付订单。创建前重新核价并核对可用状态；单次报价只提交一次，结果不确定时提示到官方 App 查看。支付在返回的官方页面完成。该创建与查询流程目前仅有代码和假外部接口测试，没有真实订单或支付实测。

这样从“想吃什么”走到“用哪些本人券、整单多少钱”。快照只展示采集时参考合计，不连接本人账号或创建订单。

## 实际调用与源码

连接时执行 `tools/list` 并由 Ajv 校验当次返回 schema；下表的使用参数来自当前实现，菜单工具 schema 与单位的历史实测见 [MCP 契约](docs/mcp-contract.md)。实际账号验收与金额见 [技术验收](docs/commerce-verification.md)。

| 官方工具 | 当前实际调用参数 | 证据与实现 |
| --- | --- | --- |
| `query-nearby-stores` | `beType=1`、`searchType=2`，加城市及地址搜索 | 已实测确认杭州建国北路286号门店 `3330251`；[菜单服务](server/mcp/catalog.ts) |
| `query-meals` | `storeCode=3330251`、`orderType=1`、`beType=1` | 实时到店菜单与当前返回状态已验收；[菜单服务](server/mcp/catalog.ts)、[可用状态](server/commerce/availability.ts) |
| `query-meal-detail` | 上述门店三项加真实商品 `code` | 菜单、杯型、食品口味、套餐子项及券商品详情；[菜单服务](server/mcp/catalog.ts)、[本人券服务](server/commerce/coupons.ts) |
| `list-nutrition-foods` | `{}` | 已成功读取 TOON/CSV；完整名称及明确规格匹配，未匹配保留未知；[菜单服务](server/mcp/catalog.ts) |
| `query-my-coupons` | `page` 与 `pageSize` 使用字符串，首次为 `"1"`、`"200"` | 已实测返回8张本人券；分页及完整性校验见 [本人券服务](server/commerce/coupons.ts) |
| `query-store-coupons` | `storeCode`、`orderType`、`beType` | 本次8张本人券中2张当前门店适用；按券ID和券码共同核对，再读取实际产品详情；[本人券服务](server/commerce/coupons.ts) |
| `calculate-price` | 门店三项、`items`、`needTableware=false` | 普通与用券整单报价均有实测；券身份仅由本机服务加入适用商品；[准备餐盘](server/mcp/quote.ts)、[本人核价](server/commerce/checkout.ts) |
| `create-order` | 重新核价后的同一餐盘参数加官方 `takeWayCode` | 已实现，仅假 gateway 测试，未真实调用；[结算实现](server/commerce/checkout.ts)、[边界测试](tests/commerce-checkout.test.ts) |
| `query-order` | 当前会话已创建订单对应的官方 `orderId` | 已实现，仅假 gateway 测试，未真实调用；客户端只能传会话内不透明订单键；[结算实现](server/commerce/checkout.ts) |

普通单品使用 `{productCode, quantity}`。历史实测巨无霸编码为 `1100`；可乐中杯使用父商品 `9900008751`，轮次 `1`、子项 `3050`，大杯子项为 `3100`。这些编码来自当次官方菜单，当前运行仍以本人新加载的上下文为准。券专用商品的 `couponId`、`couponCode` 只留在服务端私有映射，网页操作使用不透明券键；匹配、应用和撤销见 [推荐实现](src/coupons/recommend.ts)。不调用额外领券、绑定券、积分、抽奖或支付工具。`now-time-info` 在允许清单中，没有作为已验证业务成果宣传。

## 本机配置与接口

账号版安装：

```bash
npm --userconfig=/dev/null ci --include=dev
npm --userconfig=/dev/null run build:commerce
npm --userconfig=/dev/null start
```

在 `http://127.0.0.1:8788` 展开页头“连接账号”，输入从[麦当劳官方](https://open.mcd.cn/mcp)取得的本人 Token。提交后清空输入框，不写浏览器存储；Token 仅在本机服务内存会话中使用，默认30分钟有效。断开、过期或重启服务后重新连接。`start` 不读取 `.env.local`，没有项目所有者 Token 后备，Token 不放进 `VITE_*` 或公开构建。完整安装与关闭说明见 [本机运行](docs/commerce-deployment.md)。

[MCP 配置示例](mcp-config.example.json) 保留 `Bearer ${MCD_MCP_TOKEN}` 环境变量占位符，仅示范标准 MCP 客户端配置。原 `dev:api` 仍用 `.env.local` 支持旧的8787只读脚本，`dev:web` 固定5173；当前本人账号网页通过8788独立会话服务运行。

当前接口包括 `/api/commerce/connect`、`session`、`disconnect`、`stores`、`catalog`、`coupons`、`availability`、`basket-availability`、`selection`、`quote`、`orders` 和 `query-order`。这里只接受业务参数，没有任意工具转发。Host、Origin、跨站信息、请求大小、商品身份、数量、会话及报价所有权均有校验；错误转为稳定公开码，不把原始账户响应或凭据发到网页。实现见 [会话入口](server/commerce/app.ts)、[业务接口](server/commerce/routes.ts) 与 [工具白名单](server/commerce/main.ts)。

## 已验证结果与范围

2026-10-14 的 SDK 握手、门店查询、菜单/详情/营养及官方核价有真实接口记录。服务工厂注入的四分类餐盘在21:08:01（北京时间）取得6250分/¥62.50；中杯可乐1000分、大杯1200分、大杯两份2400分、巨无霸2650分和默认四件套5700分为同日较早证据。

2026-10-15 实际浏览器完成四分类、55份候选、51次选择。巨无霸、薯条、中杯可乐和新地各1份在13:00:21取得官方¥62.50；可乐改大杯、数量2后¥76.50，删除其他三行后两份大杯可乐¥24.00。修改清空旧报价，暂停恢复、撤回与返回重选也已验证，见 [浏览器记录](docs/live-verification.md#2026-10-15-真实浏览器补验)。

同日本人券流程在375px页面验收：8张本人券、2张当前门店适用；巨无霸、薯条、菠萝派餐单与“王牌小食拼”匹配2/3（67%），官方比价¥48.50 → ¥42.40。应用保留巨无霸，撤销恢复原餐品，刷新立即移除旧价差；重新应用后于21:17:32取得官方整单¥42.40。金额及券资格仅描述当次检查。未创建、支付或取消任何真实订单，不能据此声称下单支付全链路实测完成。

401、429、空/不完整菜单、缺图缺营养、缺少必选项、核价失败、不可用餐品及创建订单边界由本地假外部接口测试或独立模拟页面验证；它们不证明真实门店售罄或真实订单成功。减少动态只验证模拟媒体查询输入，未切换macOS实际设置。当前快照为2026-10-15 15:04:24（北京时间），119候选、7类、118张官方原图；来源见 [快照说明](docs/demo.md)，口味与定制见 [定制验证](docs/menu-options-verification.md)。此前连续守擂记录仅是旧版本历史证据。

当前交付为本机本人账号功能与公网快照，无公网个人账号服务。项目为独立参赛作品，餐品、券资格及金额以麦当劳官方实时结果为准。
