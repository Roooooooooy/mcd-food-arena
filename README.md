# 麦麦二选一

参赛申请已于 2026-10-16 提交：[查看官方报名记录](https://github.com/M-China/mcd-developer-innovation-challenge/issues/772)。官方校验结果以该 Issue 的回复为准。

在本机连接自己的麦当劳账号，可查本人优惠券、挑餐品、推荐用券方案、核对官方金额，并确认创建待支付订单。无需云端托管或注册 Render。

免 Token 试玩：[打开麦麦二选一](https://roooooooooy.github.io/mcd-food-arena/)（公网仅提供门店快照）。

面向不知道吃什么、想先选餐品再看整单价格的用户。自选餐品分类，每轮从候选池随机抽两份，留下更想吃的，没选的移出候选池，再重新抽两份，直到每类留下最后一份。N 份候选需要 N−1 次选择；同一份可以多次参与对比。支持候选圈选、分类手柄拖动或上下箭头排序、抛硬币、上一步、跳过和暂存；最后留下的餐品组成餐单，可调整数量、杯型和餐品。

需要 Node.js 24（本机验证版本 24.21.0），本人账号版安装步骤见下文。免 Token 的真实门店快照包含凤起路农贸市场餐厅的 119 个菜单候选、7 个分类和118张官方原图。采集于 2026-10-15 15:04:24（北京时间）；价格、规格、选项和营养仅参考当时数据。派归入甜品，菠萝派、香芋派、新地及经典麦旋风等实际口味分别参与选择，“其他”保留周边。饮料仍把同味杯型归在一个候选里，31个内部选项包含18个饮料规格和13个固定食品口味映射。安装依赖后，只运行快照前端也可用 `npm --userconfig=/dev/null run dev:web`。

快照开发命令 `dev` 同时启动 `dev:api` 和 `dev:web`，固定监听 `127.0.0.1:8787` 与 `127.0.0.1:5173`。端口被占用不会另换端口；一个服务失败会停止另一个，Ctrl+C 清理本次启动的进程树。脚本已在 macOS 验证。使用 Homebrew Node 24 时可先执行 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

本人账号版在这台电脑上运行，网页与 API 使用同一个本机服务：

```bash
git clone https://github.com/Roooooooooy/mcd-food-arena.git
cd mcd-food-arena
npm --userconfig=/dev/null ci --include=dev
npm --userconfig=/dev/null run build:commerce
npm --userconfig=/dev/null start
```

构建需要 Vite 等开发依赖，安装时使用 `--include=dev`。启动后服务仅监听本机 `127.0.0.1:8788`。

打开 `http://127.0.0.1:8788`，页头“连接账号”默认折叠，仍可先试玩门店快照。展开后粘贴从[麦当劳官方](https://open.mcd.cn/mcp)获取的本人 Token；连接成功自动读取真实门店菜单与本人券包。Token 输入框提交后立即清空，不写浏览器存储，仅在该用户的服务端内存会话中使用。默认连接有效期 30 分钟，断开、过期或服务重启后需重新连接。每个用户的菜单、券包、报价和订单状态相互隔离。目标门店为已核实的 `3330251`，杭州建国北路286号凤起路农贸市场餐厅，到店自提。

原有 `dev:api` 的 8787 只读接口和本机 `MCD_MCP_TOKEN` 配置仍兼容旧脚本；当前个人账号网页通过上述独立会话读取真实数据，没有项目所有者 Token 后备。`dev` 继续提供快照前端与旧 API。个人账号服务的 `start` 不读取 `.env.local`，Token 只由本机账号表单提交，不放进前端构建。

二选一可点击整张卡面选择，营养详情在卡片下方独立展开；也可用 Enter、空格或左右方向键选择。暂存只保存菜单上下文、分类、候选 ID、实际抽出的每轮对阵与决定，恢复时保留原对阵与候选池；刷新后先重新明确加载真实菜单，相同内容可以继续，门店、商品、规格或价格变化会要求重新选择分类。旧版规则存档会提示重新开始。旧随机回调和晚到报价仍受独立挑选记录/请求标识保护。

本人账号模式在二选一和结果处显示当前门店菜单、选项或券的返回状态及检查时间。确认未返回的餐品图片灰显、不能选入；结果保留已选记录并提示更换。官方暂未提供精确库存或售罄原因，所以不会把菜单缺席直接叫“售罄”。刷新可用状态会清除旧报价和用券前后价差，重新核价后才能确认当前金额。

最终餐单可选实际杯型、改数量、删除商品或返回分类重选。“定制餐品”默认折叠，可按门店实际选项调冰量、选配料、换燕麦奶或修改套餐搭配。同一套餐内同种子项的多份数量共用定制，营养仍按默认配方参考。快照模式只计算“快照参考合计”，未知价拒绝计算，条件价保留适用条件说明。本人账号连接后可查看适用券、匹配替换餐单、撤销替换，并主动获取官方整单报价；任何修改立即清空旧报价，未知或失败不填零。缺少必选项或未知定制内容时不猜参数。正式订单需再明确确认最新官方金额和取餐方式，支付在返回的官方页面完成。订单结果未确认时先到官方 App 查看，避免重复下单。口味与定制验证见 [记录](docs/menu-options-verification.md)，账号版边界见 [技术验收](docs/commerce-verification.md)。

2026-10-15 本机浏览器完成四分类、55份候选、51次选择。巨无霸、薯条、中杯可乐和新地各1份，在13:00:21（北京时间）取得官方整单报价¥62.50；可乐改为大杯、数量2后重新核价为¥76.50。暂停恢复、餐盘修改及390×844手机页面也已补验，金额仅对应当次选择，详见 [本轮浏览器记录](docs/live-verification.md#2026-10-15-真实浏览器补验)。

同日本人账号验收读取8张本人券，其中2张可用于当前门店。巨无霸、薯条和菠萝派餐单匹配“王牌小食拼”2/3（67%），官方比价¥48.50 → ¥42.40；应用保留巨无霸，撤销恢复原餐品。重新应用后在21:17:32（北京时间）取得官方整单¥42.40。以上是当次券资格与报价记录。创建待支付订单及查询流程已有代码和假外部接口测试，尚未创建、支付或取消任何真实订单；详见 [账号验收](docs/commerce-verification.md)。

## 界面示例

![当前公网门店快照首页](docs/screenshots/demo-home-current.png)

![当前公网快照二选一](docs/screenshots/demo-pk-current.png)

这两张展示当前公网快照试玩，使用10月15日15:04采集的数据；本人账号、查券和订单流程的验证见上文记录。

![历史门店快照首页：10月14日采集的112候选、8分类](docs/screenshots/meme-list-removed-published.png)

![历史手机二选一卡面：10月14日快照](docs/screenshots/task7-public-mobile.png)

以上两张历史图保留已发布版本的界面示例，使用10月14日快照；当前快照为119候选、7分类，本机账号入口和券流程以本文说明及账号验收为准。10月15日食品口味拆分的桌面/手机截图见 [口味与定制验证](docs/menu-options-verification.md)。

菜单快照试玩可先选择主食、小食、饮料和甜品，按偏好逐轮留下餐品，在最终餐盘挑杯型、改数量或返回重选。本机真实模式使用相同操作，最后明确请求官方整单报价。

```bash
npm --userconfig=/dev/null test
npm --userconfig=/dev/null run typecheck
npm --userconfig=/dev/null run build
npm --userconfig=/dev/null run check:public
```

GitHub Pages 静态构建使用 `VITE_PUBLIC_DEMO=true VITE_PUBLIC_COMMERCE=false npm --userconfig=/dev/null run build -- --base=/mcd-food-arena/`，只开放快照试玩。本人账号构建使用 `build:commerce`，在用户电脑上由同一 Node 服务提供网页、API 和健康检查。当前采用本机真实功能加公网快照展示，不安排公网个人账号服务。运行方式见 [本机运行说明](docs/commerce-deployment.md)。

界面与手机验收见 [UI 验证](docs/ui-verification.md)。来源与边界见 [快照说明](docs/demo.md)，旧只读接口与快照浏览器验收记录于 [验证记录](docs/live-verification.md)。构建成功与公开部署分别验证；项目不会自动报名，连接账号或取得报价也不会自动下单。

参赛所需的官方原文声明见 [CONTEST_DECLARATION.md](CONTEST_DECLARATION.md)，实际 MCP 工具与业务流程见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md)。配置文件只使用 [环境变量占位示例](mcp-config.example.json)。本次准备主赛材料；报名正文与发布核对分别见 [报名正文](docs/submission.md)、[材料核对](docs/submission-readiness.md) 和 [公开清单规则](docs/public-files.md)。

分类支持拖动左侧手柄；松手生效，Esc或列表外松手取消，已选餐品保持。键盘可空格拿起、上下移动、空格或Enter放下；上下箭头仍可用。见 [分类拖拽记录](docs/drag-order-verification.md)。
