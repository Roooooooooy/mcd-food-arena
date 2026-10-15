# 免 Token 门店快照

公开试玩默认读取 `public/demo/catalog.json`，由本人明确授权保存当前测试门店的真实公开菜单与餐品图片。门店为 `3330251`，麦当劳杭州下城区-凤起路农贸市场餐厅，杭州建国北路286号，到店自提。

本次 API 菜单加载时间为 `2026-10-14T13:26:13.931Z`，归档采集时间为 `2026-10-14T13:26:17.369Z`（北京时间2026-10-14 21:26:17）。快照包含111个菜单身份、112个餐品候选、8个分类和18个实际规格。保留分类、原始公开商品身份、父菜单编码、轮次、默认规格、口味区分及精确匹配的营养数据。2个候选的价格未知，17个候选带随单购条件价；未知值保留未知，不填零。

111个唯一图片 URL 全部来自 `https://menu-img.mcd.cn/`，下载为111个原始图片文件，共7,389,938字节。文件按内容哈希命名，保存在 `public/demo/images/`；没有生成、改绘或压缩商品照片。有一个官方 `.png` URL 与 `image/png` 响应实际包含 GIF 字节，按真实字节保存为 `.gif`。图片来源和文件对应关系记录于 `public/demo/manifest.json`。下载失败或页面图片读取失败时使用 `src/arena/FoodArt.tsx` 既有原创 SVG，不伪造商品照片。

所有快照候选保持 `mode=demo`，并标记 `sourceKind=official-snapshot`。独立的 `demo:snapshot:` 上下文可暂存和恢复本次试玩，不会转换成实时门店核价上下文。规格、价格、营养参考采集时数据，可能变化；条件价不保证适用。餐盘金额是已知参考价相加的“快照参考合计”，不校验实时费用、优惠或套餐选配，不是实时官方购买报价。未知价、未选规格或失效规格拒绝计算，修改餐盘后合计失效；复制和下载餐单保留快照时间、来源和条件价说明。

公开模式用 `VITE_PUBLIC_DEMO=true` 构建，隐藏真实菜单控件，并在 API 客户端拦截门店搜索、实时菜单、选配和核价请求。本页只加载本站归档 JSON 与图片，资源路径跟随 `import.meta.env.BASE_URL`，支持 `/mcd-food-arena/` 子路径。本人本地开发仍可切换真实菜单，明确读取与核价；前端没有凭据输入，归档和构建不加载认证文件。

可重复采集（先运行本人本地 API）：

```bash
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm --userconfig=/dev/null run demo:capture
VITE_PUBLIC_DEMO=true PATH=/opt/homebrew/opt/node@24/bin:$PATH npm --userconfig=/dev/null run build -- --base=/mcd-food-arena/
```

采集脚本只 GET 本机 `127.0.0.1:8787/api/catalog` 的归一化公开结果；不读取 Token 或环境文件。输出按明确白名单重建：菜单仅保留上下文、只读模式、来源、采集/加载时间、完整性、公开门店、候选和菜单身份数；门店仅保留 id/name/city/address；候选仅保留公开名称/编码/分类/图片/参考价/属性/营养/规格及默认规格；规格仅保留公开 id/code/name/size/price/nutrition/image/menuCode/roundId。营养只保留 kcal、proteinG、fatG、carbsG、sodiumMg。丢弃请求头、trace、账号、frequent 与其他未允许字段。图片只允许指定公开 HTTPS 主机，不接受凭据、查询参数、锚点或重定向；最多160个 URL、4个并发、每图1 MiB、总下载预算20 MiB、每次15秒、最多2次尝试。

`src/demo/menu.ts` 仍保留40份原创合成餐品作为兼容 fixture，`demoForDisplay()` 仍验证鸡肉小食合并而不丢失身份。它不作为应用默认数据源。`tests/fixtures/catalog.json`、`catalog-details.json`、`quote.json` 是之前真实接口验证的公开字段摘录；人工错误、缺价和费用案例用于测试。构建通过不等于公开部署完成。
