# 麦麦擂台

自选餐品赛区，逐轮二选一，胜者迎接下一位挑战者，直到筛选内全部候选出场。支持候选圈选、赛区排序、抛硬币、上一步、跳过和暂存；冠军组成可调整数量、杯型和餐品的整餐。

需要 Node.js 24（本机验证版本 24.21.0）。首次运行：

```bash
npm --userconfig=/dev/null install
npm --userconfig=/dev/null run dev
```

打开 <http://127.0.0.1:5173>。默认是免 Token 的真实门店快照试玩：凤起路农贸市场餐厅的 112 个候选、8 个赛区、18 个规格和 111 张官方原图保存在本站。采集于 2026-10-14 21:26:17（北京时间）；价格、规格和营养仅参考当时数据。只运行快照前端也可用 `npm --userconfig=/dev/null run dev:web`。

`dev` 同时启动 `dev:api` 和 `dev:web`，固定监听 `127.0.0.1:8787` 与 `127.0.0.1:5173`。端口被占用不会另换端口；一个服务失败会停止另一个，Ctrl+C 清理本次启动的进程树。脚本已在 macOS 验证。使用 Homebrew Node 24 时可先执行 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

本人本地真实模式使用官方 MCP：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

在本机编辑 `.env.local` 的 `MCD_MCP_TOKEN` 后运行 `npm --userconfig=/dev/null run dev`。只有 API 子进程通过 `--env-file-if-exists=.env.local` 读取该文件；文件被忽略，凭据不进入前端、公开快照或命令参数。页面启动不会自动连接 MCP；切换真实模式并明确加载菜单后才读取。目标门店为已核实的 `3330251`，杭州建国北路286号凤起路农贸市场餐厅，到店自提。

比赛页面可用左右方向键选择。暂存只保存菜单上下文、赛区、候选 ID 与决定；刷新后先重新明确加载真实菜单，相同内容可以继续，门店、商品、规格或价格变化会要求重新选择赛区。旧随机回调和晚到报价仍受独立赛程/请求标识保护。

冠军餐盘可选实际杯型、改数量、删除餐品或返回赛区重选。快照模式只计算“快照参考合计”，未知价拒绝计算，条件价保留适用条件说明。本人本机真实金额由“获取官方整单报价”主动核价，任何修改立即清空旧报价；未知或失败不填零。当前支持真实杯型与可确认的官方默认套餐内容，缺少必选默认项会提示待选配。整个流程不会创建订单。

```bash
npm --userconfig=/dev/null test
npm --userconfig=/dev/null run typecheck
npm --userconfig=/dev/null run build
```

GitHub Pages 静态构建使用 `VITE_PUBLIC_DEMO=true npm --userconfig=/dev/null run build -- --base=/mcd-food-arena/`，只开放快照试玩，真实菜单须在本机运行。

来源与边界见 [快照说明](docs/demo.md)，真实接口、注入测试和浏览器验收分别记录于 [验证记录](docs/live-verification.md)。构建成功与公开部署分别验证；本项目不会自动报名或创建订单。
