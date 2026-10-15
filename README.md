# 麦麦二选一

直接试玩：[打开麦麦二选一](https://roooooooooy.github.io/mcd-food-arena/)（免 Token，使用下述门店快照）。

自选餐品分类，每轮从候选池随机抽两份，留下更想吃的，没选的移出候选池，再重新抽两份，直到每类留下最后一份。N 份候选需要 N−1 次选择；同一份可以多次参与对比。支持候选圈选、分类手柄拖动或上下箭头排序、抛硬币、上一步、跳过和暂存；最后留下的餐品组成餐单，可调整数量、杯型和餐品。

需要 Node.js 24（本机验证版本 24.21.0）。首次运行：

```bash
npm --userconfig=/dev/null install
npm --userconfig=/dev/null run dev
```

打开 <http://127.0.0.1:5173>。默认是免 Token 的真实门店快照试玩：凤起路农贸市场餐厅的 119 个菜单候选、7 个分类、118 张官方原图保存在本站。采集于 2026-10-15 15:04:24（北京时间）；价格、规格、选项和营养仅参考当时数据。派归入甜品，菠萝派、香芋派、新地及经典麦旋风等实际口味分别参与选择，“其他”保留周边。饮料仍把同味杯型归在一个候选里，31个内部选项包含18个饮料规格和13个固定食品口味映射。只运行快照前端也可用 `npm --userconfig=/dev/null run dev:web`。

`dev` 同时启动 `dev:api` 和 `dev:web`，固定监听 `127.0.0.1:8787` 与 `127.0.0.1:5173`。端口被占用不会另换端口；一个服务失败会停止另一个，Ctrl+C 清理本次启动的进程树。脚本已在 macOS 验证。使用 Homebrew Node 24 时可先执行 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

本人本地真实模式使用官方 MCP：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

在本机编辑 `.env.local` 的 `MCD_MCP_TOKEN` 后运行 `npm --userconfig=/dev/null run dev`。只有 API 子进程通过 `--env-file-if-exists=.env.local` 读取该文件；文件被忽略，凭据不进入前端、公开快照或命令参数。页面启动不会自动连接 MCP；切换真实模式并明确加载菜单后才读取。目标门店为已核实的 `3330251`，杭州建国北路286号凤起路农贸市场餐厅，到店自提。

二选一可点击整张卡面选择，营养详情在卡片下方独立展开；也可用 Enter、空格或左右方向键选择。暂存只保存菜单上下文、分类、候选 ID、实际抽出的每轮对阵与决定，恢复时保留原对阵与候选池；刷新后先重新明确加载真实菜单，相同内容可以继续，门店、商品、规格或价格变化会要求重新选择分类。旧版规则存档会提示重新开始。旧随机回调和晚到报价仍受独立挑选记录/请求标识保护。

最终餐单可选实际杯型、改数量、删除商品或返回分类重选。“定制餐品”默认折叠，可按门店实际选项调冰量、选配料、换燕麦奶或修改套餐搭配。同一套餐内同种子项的多份数量共用定制，营养仍按默认配方参考。快照模式只计算“快照参考合计”，未知价拒绝计算，条件价保留适用条件说明。本人本机真实金额由“获取官方整单报价”主动核价，任何修改立即清空旧报价；未知或失败不填零。缺少必选项或未知定制内容时不猜参数。整个流程不会创建订单。验证见 [口味与定制记录](docs/menu-options-verification.md)。

```bash
npm --userconfig=/dev/null test
npm --userconfig=/dev/null run typecheck
npm --userconfig=/dev/null run build
```

GitHub Pages 静态构建使用 `VITE_PUBLIC_DEMO=true npm --userconfig=/dev/null run build -- --base=/mcd-food-arena/`，只开放快照试玩，真实菜单须在本机运行。

界面与手机验收见 [UI 验证](docs/ui-verification.md)。来源与边界见 [快照说明](docs/demo.md)，真实接口、注入测试和浏览器验收分别记录于 [验证记录](docs/live-verification.md)。构建成功与公开部署分别验证；本项目不会自动报名或创建订单。

“调整餐品与顺序”支持拖动左侧手柄。拖动预览不修改已选餐品，松手生效，Esc或列表外松手取消；键盘也可用空格拿起、上下移动、空格或Enter放下。验证见 [分类拖拽记录](docs/drag-order-verification.md)。
