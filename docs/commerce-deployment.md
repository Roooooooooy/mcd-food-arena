# 本人账号版部署

此版本先用本站门店快照试玩。页头“连接账号”展开后，可输入从[麦当劳官方](https://open.mcd.cn/mcp)取得的本人 Token，读取真实菜单与本人券包、核对整单金额，并在另一次明确确认后创建本人订单。支付需前往返回的官方页面。GitHub Pages 仍只提供免 Token 的冻结菜单试玩；本人账号版需要下面的 Node 服务。

## 本机运行

使用 Node 24（本次验证 24.21.0）：

```bash
npm --userconfig=/dev/null ci --include=dev
npm --userconfig=/dev/null run build:commerce
npm --userconfig=/dev/null start
```

构建阶段必须安装 Vite 等开发依赖；`--include=dev` 使这套命令在 `NODE_ENV=production` 下也能完成构建。服务运行仍使用生产环境。

打开 `http://127.0.0.1:8788`。这一个进程同时提供网页、图片、`/api/commerce/*` 和 `/healthz`。启动不读取 `.env.local`，不自动连接 MCP。个人 Token 只由用户在页面提交；不要将其设置为共享服务器环境变量或任何 `VITE_*` 构建变量。

如默认端口已被占用，可使用 `PORT=8989 npm --userconfig=/dev/null start` 并打开 `http://127.0.0.1:8989`。不会自动寻找备用端口。原 `dev:api` 的 8787 只读接口仍兼容旧脚本；新的页面通过本人会话访问实时功能。

## Render 免费服务交接

仓库根目录的 `render.yaml` 仅声明一个原生 Node **Free Web Service**：一个实例、一个进程、Singapore 区域，无数据库、磁盘或其他资源。首次试用关闭自动部署，后续手动部署会重启服务。当前文件没有创建任何线上资源。

代码验收并确认发布后，由用户登录 Render，选择 `New > Blueprint`，连接此仓库、选择验收过的分支。检查将创建的清单只有这个服务，计算方案确实为 **Free**，然后由用户确认部署。GitHub 授权、注册、登录及任何额外身份或支付验证均由用户处理。

| 环境变量 | 用法 |
| --- | --- |
| `NODE_VERSION` | Blueprint 固定 `24.21.0`。 |
| `HOST` | 本机默认 `127.0.0.1`；Blueprint 显式设置 `0.0.0.0`。 |
| `PORT` | 本机默认 `8788`；Render 提供，通常 `10000`，必须是 1–65535 的整数。 |
| `PUBLIC_ORIGIN` | 可选，完整且规范的公开 HTTPS origin，例如 `https://meal.example.com`；不含路径、末尾斜线、账号、查询或片段。 |
| `RENDER_EXTERNAL_URL` | 未设置 `PUBLIC_ORIGIN` 时，程序读取 Render 提供的 HTTPS URL；不从请求 Host 或代理头推导。 |

外部由 Render 终止 TLS；应用使用配置的外部 HTTPS Origin 校验来源并设置 Secure cookie。自定义域名需要显式改 `PUBLIC_ORIGIN` 并重新部署；此时仅该域名可访问网页及 API。健康检查只返回 `{ "status": "ok" }`，不读取账号或访问 MCP。不要在 Blueprint 使用 `${RENDER_EXTERNAL_URL}` 插值，Render 不支持这种替换。

部署完成后需核对外部 HTTPS、首页和冻结图片、`/healthz`、本站连接与断开、cookie 及来源限制，再检查官方菜单、券详情和只读核价。首次验证到核价为止；真实创建订单另按用户的明确意图操作。本轮代码验收未代替这些线上检查。配置依据为 Render 的[Web Services](https://render.com/docs/web-services)、[默认环境变量](https://render.com/docs/environment-variables)、[Node 版本](https://render.com/docs/node-version)和[Blueprint 规范](https://render.com/docs/blueprint-spec)。

## 免费试用的限制

Render Free 在 15 分钟没有入站请求后休眠，下次访问约需 1 分钟唤醒，也可能随时重启。Token、会话、券缓存、报价及订单提交状态都在进程内存里，休眠、重启或部署后可能丢失，用户需要重新连接。不要增加后台保活来绕过休眠。

订单提交结果若曾未确认，应先到官方 App 查看订单，避免重复下单。重新连接不会恢复本站之前的提交锁或在途记录，也不会自动再次创建订单。这个单进程试用包不提供持久的订单幂等保证。

免费额度和可用性以 Render 当时规则为准；2026-10-15 核对的[免费服务说明](https://render.com/docs/free)和[定价](https://render.com/pricing)记录每工作区每月 750 免费实例小时、Hobby 5GB 出站和 500 分钟构建。出站 MCP 连通性、Singapore 区域延迟和多人容量仍需线上实测。
