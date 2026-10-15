# 公开文件清单

公开范围由 `scripts/check-public.ts` 的固定路径清单约束，不从整个工作区直接压缩。当前 `SOURCE_FILES` 固定列出120个可运行源码、测试、公开fixtures、依赖锁、构建配置、官方必需材料、配置占位示例及来源/验证文档。`render.yaml` 是此前托管方案的兼容配置，本次本机运行不使用它；保留文件不表示已部署公网个人账号服务。

`public/demo/catalog.json` 与 `manifest.json` 保存2026-10-15 15:04:24（北京时间）的门店快照：119候选、7类、118张官方原图。图片仅按manifest逐项允许；检查器核对来源主机 `menu-img.mcd.cn`、路径内容哈希、数量和总字节，额外图片不会自动收录。`dist` 只允许入口引用的Vite JS/CSS，以及与公开快照逐字节相同的JSON及图片，额外构建文件会拒绝。

截图固定允许16张，分别用于公开演示与验证文档，实际存在的允许文件才进入清单：

| 用途 | 固定允许路径（均位于 `docs/screenshots/`） |
| --- | --- |
| README当前公网快照首页与二选一（2张） | `demo-home-current.png`、`demo-pk-current.png` |
| README历史界面，10月14日快照（2张） | `meme-list-removed-published.png`、`task7-public-mobile.png` |
| 浏览器菜单、对阵、桌面与手机餐单（4张） | `task6-live-menu-desktop.png`、`task6-live-match-desktop.png`、`task6-live-result-desktop.png`、`task6-live-result-mobile.png` |
| 分类拖拽（4张） | `drag-order-desktop.png`、`drag-order-mobile.png`、`drag-order-preview.png`、`drag-order-published.png` |
| 食品口味与定制（4张） | `menu-customization-mobile.png`、`menu-customization.png`、`pie-flavors-mobile.png`、`pie-flavors.png` |

当前两张公网图只展示门店快照；原有14张截图本轮已逐张看图，未见Token输入值、个人邮箱或真实订单标识。README历史两张和拖拽四张使用10月14日快照，`task6-live-`四张保留10月15日13:00核价前后旧界面；口味/定制四张使用10月15日15:04快照。它们按对应历史验证归因，不证明最新本人券/订单界面已截图。图片白名单不代替可见信息的隐私审阅。其他历史截图保留在本机，不进入提交包。

`.git/`、`node_modules/`、`.env.local`、其他本机环境文件、`.private/`、`.superpowers/`、`docs/superpowers/`、内部进度文档、历史任务1–2记录和未选历史截图明确排除，原文件保留。四份内部研究文档仅按检查器列出的完整文件名排除，不开放新的目录白名单；工作区中其他未识别文件会报错，不会默默进入包。

无 `dist` 时，公开源码、快照JSON/图片与16张允许截图合计256个文件；当前Pages构建另产生入口、JS/CSS和120个快照文件，因此完整包合计379个文件。Git提交只包含固定公开源码/素材，`dist`作为构建与打包产物不提交。

使用 `npm --userconfig=/dev/null run check:public -- --ci --manifest=.private/release/public-files.json` 生成逐文件大小与SHA-256清单；追加 `--package=.private/release/mcd-food-arena` 可生成包含源码与静态构建的新目录。两项操作仅在全部检查通过后写入新的 `.private/release/` 路径，拒绝符号链接和目录覆盖。CI格式模式不读取本机凭据；发布前由主任务另外完成本人Token的字面与常见编码扫描。
