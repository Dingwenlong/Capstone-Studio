# 毕设演示室

学生从 [演示首页](http://portal.classroom.localhost:3410/) 登录，在一个工作台里打开获准系统。老师使用独立的 [教师管理入口](http://admin.classroom.localhost:3410/login) 分配账号和系统。

首次进入默认显示英文。学生首页和两个登录页均可直接选择「简体中文」或「English」。语言选择会保留至下次访问，并用于学生工作台、教师后台和两个内置系统。外接系统会收到所选语言的 `Accept-Language` 请求头，其内容取决于该系统提供的翻译。

每个登录页有两个免输密码的示例按钮。示例学生 A 初始可进入图书借阅与实验室预约，示例学生 B 初始只可进入实验室预约。两位示例教师管理同一套示例账号、授权和课堂数据。示例操作与正式师生数据隔离；正式授课请使用老师分配的账号和密码。示例登录也使用一次性请求编号。首次使用时自动初始化示例数据，本机使用独立 PGlite 目录，PostgreSQL 使用独立 schema。

## 本机使用

使用 Node.js 24、PowerShell 和 Chrome 或 Edge。默认服务仅监听回环地址，四个 `.classroom.localhost` 主机名可直接在当前电脑浏览器打开。

新安装时在项目目录依次运行以下命令。已经初始化的安装直接执行最后一行。

```powershell
.\classroom.ps1 install
.\classroom.ps1 build
.\classroom.ps1 init
.\classroom.ps1 start
```

另开 PowerShell 运行 `.\classroom.ps1 accounts` 查看首次分配的密码。每次新安装都会随机生成密码。Windows 启动脚本将初始凭据用当前 Windows 用户的 DPAPI 加密保存在本机用户目录；老师重置过的学生密码以新密码为准。用 `.\classroom.ps1 stop` 正常停止本机服务。前台运行也可按 Ctrl+C。

| 账号 | 首次分配 | 课堂操作 |
| --- | --- | --- |
| `teacher` | 教师后台 | 创建学生、重置密码、停用账号、登记或上下架系统、修改授权、查看近 150 条操作记录 |
| `student-a` | 图书借阅、实验室预约 | 查询并借还图书，打开另一个页签预约时段，再切回之前的查询 |
| `student-b` | 实验室预约 | 查看共享时段和预约结果；可取消自己的预约 |

用两个独立浏览器配置文件或普通窗口加无痕窗口分别登录 A、B。先让 A 预约一个时段，再由 B 刷新预约页即可看到占用状态。老师可在“系统授权”选择学生、勾选系统并保存；保存后旧页签的下一次请求会重新校验。工作台在重新获得焦点和定时刷新时也会更新目录。

## 存储、迁移与恢复

本机默认数据库目录为 `.data/classroom`，可通过 `DATA_DIR` 指定独立目录。网关独占本地数据库；内置的两个演示页面运行在各自的子进程中。停止本机服务，等进程退出，再执行离线迁移。备份含密码哈希和课堂记录，应保存到受限目录。

```powershell
node --import tsx scripts/data.ts export <新备份文件>
$env:DATA_DIR = '<用于恢复的空目录>'
node --import tsx scripts/data.ts import <备份文件>
node --import tsx scripts/data.ts export <复核用的新文件>
```

比对两次导出显示的 SHA-256。导入会验证格式、摘要、引用关系和库存数量，并整体提交到空库。恢复保留账号、密码哈希、系统、授权、业务数据和审计记录；师生重新登录获取新会话。设置 `DATABASE_URL` 时，同一套命令连接 PostgreSQL。结构迁移在打开数据库时执行。

## 公网部署

部署模板位于 `deploy/`。为 `portal`、`admin`、`library`、`lab` 四个子域设置 DNS，指向运行反向代理的服务器。在部署环境设置 `BASE_DOMAIN`（四个子域共用的域名后缀）和 `DB_PASSWORD`（可用随机 32 字节的十六进制字符串），然后运行以下命令。

```sh
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml build app
docker compose -f deploy/compose.yaml up -d database
```

首次全新部署可用下面的初始化命令取得随机初始凭据，保存到密码管理器。

```sh
docker compose -f deploy/compose.yaml run --rm app node --import tsx scripts/data.ts init
```

从本机迁移时，在空 PostgreSQL 数据库上执行导入，然后再启动站点。例如，在 Linux 主机上将备份放入仅部署人员可访问的目录，并允许容器内的 `node` 用户只读访问该文件。

```sh
docker compose -f deploy/compose.yaml run --rm -v "$PWD/classroom-export.json:/restore/classroom.json:ro" app node --import tsx scripts/data.ts import /restore/classroom.json
docker compose -f deploy/compose.yaml up -d
docker compose -f deploy/compose.yaml ps
```

全新部署在初始化后也运行最后两行。Caddy 为四个主机名申请 HTTPS 证书。对外开放 80、443，PostgreSQL 和应用端口保留在容器网络内。先检查健康状态和四个主机的 TLS，再用普通学生和教师完成一轮授权、借还和预约验证。

## 接入自己的演示系统

1. 让真实系统只接受网关所在私有网络的连接。为每个系统准备独立子域，将其添加到 Caddyfile 和 DNS。子系统的嵌入策略应允许学生门户作为父页面。
2. 在网关运行环境通过 `TARGETS_FILE` 指向只读 JSON 清单。容器部署需要挂载这个文件。键名使用小写英文、数字和短横线。下面是内网服务的示例。

   ```json
   [{"key":"inventory","name":"库存管理","upstream":"http://inventory:8080"}]
   ```

3. 重启网关后，在教师后台“演示系统”选择清单内的目标、登记名称，再到“系统授权”分配。网关会在转发每个请求前检查学生、原登录会话和目标系统的当前授权。内部服务从网关注入的 `X-Classroom-User-Id` 获取身份。
4. 首版接入支持同源相对地址的 HTTP 页面、静态资源和 JSON/表单接口，单次上行正文上限 2 MiB。子系统使用网关提供的身份，写入端自行签发并在业务事务中核销一次性请求编号。接入前验证重复提交、超时重试和撤权。请先适配依赖独立登录 Cookie、跨域跳转或 WebSocket 的系统。

## 验证与开发

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Windows 下可直接执行 `.\classroom.ps1 check`、`.\classroom.ps1 test` 和 `.\classroom.ps1 build`。如本机已安装 Chrome，PowerShell 可设置 `$env:CHROMIUM_CHANNEL='chrome'`，随后运行 `.\classroom.ps1 browser`。脚本直接调用 Node，可以在 Windows 环境变量较长时使用。测试运行器创建临时数据库，使用随机账户密码，启动独立服务进程，完成后正常关闭。可设置 `CLASSROOM_TEST_PORT` 和 `CLASSROOM_QA_OUTPUT` 选择测试端口及截图位置。存储测试默认使用 PGlite，`CLASSROOM_TEST_DATABASE_URL` 可指向专用的空 PostgreSQL 测试库。

开发运行 `npm run dev`，生产构建后运行 `npm start`。学生门户、教师后台使用 Next.js Pages Router、React 和 Tailwind。tRPC 处理查询和写入，Drizzle 连接 PGlite 或 PostgreSQL，Better Auth 的密码组件处理哈希和校验。会话、一次性启动票据及请求编号由网关与数据库管理。

登录和写操作先领取绑定主机、当前会话与操作的 `X-Request-ID`，有效期 5 分钟。登录前绑定匿名会话；借还、预约和管理操作在同一个事务里核销编号并写入业务数据。页签启动票据绑定目标系统，有效期 30 秒，通过 POST 兑换。学生退出、停用、重置密码或被撤权后，关联会话按对应范围失效。
