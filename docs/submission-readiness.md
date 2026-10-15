# 参赛材料核对

本次准备主赛材料，未选择 WorkBuddy 专项，没有 `workbuddy.md` 或 WorkBuddy 开发经历的主张。报名正文保存在 [submission.md](submission.md)，仅包含官方要求的四行，尚未发布报名 Issue。

## 官方来源

规则来源为 [麦当劳官方活动仓库](https://github.com/M-China/mcd-developer-innovation-challenge)。2026-10-15 首次读取的仓库版本为 `e064990edcfa9d85b62f8707b089204a547092ba`，保留为历史来源记录；主会话本轮在当前版本 `cf25843` 再次复查，官方声明字节未变。所需材料为 `README.md`、`MCP_INTEGRATION.md`、文件名及内容均不改的 `CONTEST_DECLARATION.md`、仅使用环境变量占位符的 `mcp-config.example.json` 和可运行源代码。声明从本次下载的官方文件直接复制；本地检查还会逐字节比较。公开 CI 使用固定声明 SHA-256 核对，不需要私有下载目录。

## 公开内容与运行范围

- [现有公开仓库](https://github.com/Roooooooooy/mcd-food-arena) 与 [快照试玩](https://roooooooooy.github.io/mcd-food-arena/) 已存在；本轮准备的材料是否进入远程，以发布后的版本为准。
- 公开网页使用2026-10-15 15:04:24（北京时间）的凤起路农贸市场餐厅快照，119候选、7类、118张官方原图；保留图片与来源。本机本人账号版默认8788，输入自己的Token后查询菜单/券，按编码数量推荐方案并支持替换撤销、官方核价和用户明确确认创建待支付订单；支付在官方页面完成。公网仅快照，无公网个人账号服务或Render上线安排。
- SDK/HTTP 实测与当前浏览器补验分别记录于 [live-verification.md](live-verification.md)。本轮真实菜单、8张本人券/2张门店适用券、匹配应用撤销及官方核价已补验；王牌小食拼匹配2/3（67%），当次¥48.50 → ¥42.40，21:17:32取得官方整单¥42.40。创建与查询订单只有代码/假边界测试，从未创建、支付或取消真实订单。恢复及餐盘修改和本地假接口故障页面已补验；减少动态使用模拟输入，未切换macOS实际设置，演示录像未录制。
- 项目未声称分析完整历史账户、全榜唯一或麦当劳官方认证。

## 本地验证与打包

在 Node.js 24 下执行：

```bash
npm --userconfig=/dev/null ci --include=dev
node --test --test-concurrency=1 tests/*.test.ts
npm --userconfig=/dev/null run typecheck
npm --userconfig=/dev/null run build:commerce -- --outDir=.private/commerce-dist
VITE_PUBLIC_DEMO=true VITE_PUBLIC_COMMERCE=false npm --userconfig=/dev/null run build -- --base=/mcd-food-arena/
npm --userconfig=/dev/null run check:public -- --ci
npm --userconfig=/dev/null run check:public -- --ci --manifest=.private/release/public-files.json --package=.private/release/mcd-food-arena
```

当前隔离发布工作树没有 `.env.local`，本轮命令使用 `--ci`，不读取或复制任何本人Token。检查器的非CI本地模式可仅在进程中读取忽略的 `.env.local`，扫描实际Token的字面与常见序列化形式；主任务在主目录另行完成此扫描。CI模式只执行文件与格式规则。所有诊断只给文件、行号和原因，不输出匹配内容。检查不是完整的凭据审计，仍须审阅公开清单和截图。

.private中的旧包与ZIP保留。当前固定公开清单和截图数量见 [公开范围](public-files.md)。账号与Pages构建需分别验证，最终 `dist/` 必须是Pages快照构建，账号构建另存本机私有目录。

打包命令仅写新的 `.private/release/` 目录，不覆盖现有包。未知文件会使检查失败；私有配置、内部规划和未选历史截图不会进入包。清单列出每个文件的大小与 SHA-256，包从通过检查的同一批字节生成。压缩、远程更新与正式报名由主任务在授权范围内单独处理。
