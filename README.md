# 程序研习录

学生从 [学习首页](http://portal.classroom.localhost:3410/) 登录，在工作台页签中浏览老师分配的系统截图。每个系统可按客户端、管理端、小程序、桌面或自定义分组展示缩略图，点击后放大查看。老师使用独立的 [教师管理入口](http://admin.classroom.localhost:3410/login) 管理学生、系统资料、截图和授权。新增相册使用同一组学生、教师入口及数据库。

首次进入默认显示英文。学生首页和两个登录页均可直接选择「简体中文」或「English」。语言选择会保留至下次访问，并用于工作台、教师后台、图片预览和操作反馈。系统资料支持中文及英文名称、简介，自定义截图名称和分组沿用老师填写的内容。

每个登录页有两个免输密码的示例按钮。示例学生 A 初始可查看图书借阅与实验室预约相册，示例学生 B 初始只可查看实验室预约相册。两位示例教师共用同一套示例账号、授权和截图。示例操作保存在独立空间，正式授课使用老师分配的账号和密码。示例登录也使用一次性请求编号。首次使用时自动初始化示例数据，本机使用独立 PGlite 目录，PostgreSQL 使用独立 schema。新相册显示实际截图数量，等待老师上传后即可浏览。

## 本机使用

使用 Node.js 24、PowerShell 和 Chrome 或 Edge。默认服务仅监听回环地址，学生和教师的 `.classroom.localhost` 主机名可直接在当前电脑浏览器打开。

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
| `teacher` | 教师后台 | 创建学生、重置密码、停用账号、编辑系统资料、管理截图、上下架系统、修改授权、查看近 150 条操作记录 |
| `student-a` | 图书借阅、实验室预约 | 按分组查看已上传截图，切换页签、放大及前后翻图 |
| `student-b` | 实验室预约 | 查看自己获授权的系统截图 |

老师在“演示系统”导航下进入“系统资料”，新增系统名称和标识，按需填写英文名称、简介、平台标签及项目地址。打开“管理截图”，填写分组、选择图片并上传，可逐张改名、调整分组、在组内前移或后移、删除，也可批量重命名已有分组。项目地址供教师维护来源使用。然后在“系统授权”选择学生、勾选系统并保存。

用两个独立浏览器配置文件或普通窗口加无痕窗口分别登录 A、B，核对两人的可见目录。缩略图与完整尺寸图片均通过当前入口的鉴权接口读取，服务端每次检查登录、系统上架状态和学生授权。下架或撤权后，后续图片读取会被拒绝，工作台在重新获得焦点及定时回读时移除相应页签。

## 上传限制与容量

- 接受静态 PNG、JPEG、WebP，单个上传文件最大 8 MiB，解码像素上限为 4000 万。每个系统最多保存 200 张截图，相同系统中的重复图片会被拒绝。
- 服务器按图片方向处理并保存 WebP 展示图，保持比例缩至宽 3840、高 16383 像素以内，同时生成最长边 480 像素的缩略图。放大查看使用保存后的展示图。
- 教师管理显示的占用为展示图和缩略图实际字节数之和。数据库磁盘空间还包含表、索引、事务日志等开销，容量按上传后的统计与数据库实际占用评估。
- 多张图片逐张提交，每张有独立结果。已知失败可单独重试，提交结果未确认时先刷新列表核对。服务器最多同时处理两次图片上传，繁忙请求会提示稍后重试。
- 公开示例空间共用最多 100 张截图、20 MiB 图片字节额度，额度累计包含两位示例教师上传的内容。

## 批量导入系统资料

可用本地 JSON 清单批量创建相册。下面为通用格式示例，`repository` 是可选的 HTTPS 来源地址。

```json
{
  "projects": [
    {
      "key": "campus-library",
      "name": "校园图书管理",
      "nameEn": "Campus Library",
      "summary": "图书目录、借阅与后台管理的界面参考。",
      "summaryEn": "Interface references for catalog browsing, loans and administration.",
      "repository": "https://example.com/source/campus-library",
      "platforms": ["Client", "Admin", "Mini program"]
    }
  ]
}
```

`key` 使用 1 至 32 位小写字母、数字和短横线，以字母开头。必填字段为 `key`、`name`，其余字段可省略。名称上限为 80 字符，英文名称 120 字符，中文简介 2000 字符，英文简介 4000 字符。单次清单最多 500 个项目，标识必须唯一。

本机先停止服务，随后执行导入。命令复用 `DATA_DIR` 或 `DATABASE_URL`，整批在事务中提交，输出新增与跳过的标识。已有标识会被跳过，其资料可在教师后台编辑。新建相册初始上架、截图数量为零，老师上传图片并分配账号后学生即可查看。

```powershell
.\classroom.ps1 stop
node --import tsx scripts/gallery-import.ts <本地项目清单.json>
.\classroom.ps1 start
```

服务器可把清单只读挂载到一次性应用容器，使用同一命令完成资料导入。

```sh
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml run --rm --no-deps -v "$PWD/projects.json:/import/projects.json:ro" app node --import tsx scripts/gallery-import.ts /import/projects.json
```

## 存储、迁移与恢复

本机默认数据库目录为 `.data/classroom`，可通过 `DATA_DIR` 指定独立目录。服务器使用 PostgreSQL，Compose 数据卷 `classroom_data` 保存数据库。系统资料、授权、截图元数据、WebP 展示图及缩略图均随数据库持久化。应用启动会在事务中将旧版结构升级到 v2。

本地数据库由应用独占。停止本机服务，等进程退出，再导出正式数据。导出文件包含账号密码哈希、授权、图片和审计记录，应保存到受限目录。当前导出格式为 `demo-classroom-v2`，图片以 Base64 编码，因此文件还包含约三分之一的图片编码开销及 JSON 元数据。

```powershell
node --import tsx scripts/data.ts export <新备份文件>
$env:DATA_DIR = '<用于恢复的空目录>'
node --import tsx scripts/data.ts import <备份文件>
node --import tsx scripts/data.ts export <复核用的新文件>
```

同为 v2 格式时，比对恢复前后导出的 SHA-256。导入会验证总摘要、图片摘要与字节数、实际图片尺寸和格式、截图排序及关联记录，再整体提交到空库。恢复保留账号、密码哈希、系统资料、授权、截图、旧业务数据和审计记录，师生重新登录获取新会话。设置 `DATABASE_URL` 时，同一套命令连接 PostgreSQL。

导入也支持旧 `demo-classroom-v1` 备份，升级后的相册等待上传截图。旧备份再次导出时使用 v2 格式，摘要会随格式变化，应同时核对导入输出的各表记录数量。恢复目标选择独立空库或空目录，保留来源库直至恢复结果核对完成。

`scripts/data.ts` 备份正式空间。示例数据在本机的 `DATA_DIR` 后缀 `-examples` 目录中，PostgreSQL 下位于 `classroom_public_examples` schema。需要保留示例空间时，应一并纳入数据库或目录级备份。

## 公网部署

部署模板位于 `deploy/`。服务器需要 Docker Engine 和 Docker Compose 插件。在项目根目录的受限 `.env` 文件中设置 `BASE_DOMAIN`（根域名和子域共用的后缀）及 `DB_PASSWORD`（随机 32 字节的十六进制字符串）。后续命令均从项目根目录执行，并通过 `--env-file .env` 显式读取该配置。

本项目公网域名设置为 `BASE_DOMAIN=education.sc.cn`。备案完成后，学生访问 `https://student.education.sc.cn/`，教师访问 `https://teacher.education.sc.cn/login`。根域 `education.sc.cn` 跳转至学生门户。应用内部使用 `portal`、`admin` 区分角色，本机入口继续使用 `portal.classroom.localhost` 与 `admin.classroom.localhost`。当前 Caddy 模板还保留 `library.education.sc.cn` 和 `lab.education.sc.cn` 的旧演示兼容入口。

默认从 Docker Hub 拉取 Node.js、PostgreSQL 和 Caddy 官方镜像。服务器访问 Docker Hub 超时时，可在同一 `.env` 中加入 Docker 官方 ECR Public 路径，然后执行后面的构建及启动命令。[Docker 官方镜像目录](https://gallery.ecr.aws/docker/)

```dotenv
NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim
POSTGRES_IMAGE=public.ecr.aws/docker/library/postgres:16-bookworm
CADDY_IMAGE=public.ecr.aws/docker/library/caddy:2-alpine
```

三个变量均接受完整镜像引用，包括 `镜像路径@sha256:摘要`。固定版本时使用从对应镜像仓库核验过的摘要。Node.js 构建阶段和运行阶段使用相同的 `NODE_IMAGE`。

### 服务器准备

域名备案办理期间，使用 `prepare.yaml` 启动数据库和应用。该覆盖文件只为应用增加 `127.0.0.1:3410` 监听。准备阶段的启动命令始终指定 `database app`，代理服务留待正式启用。2 GiB 服务器先完成镜像构建，再启动容器。

```sh
docker info
docker compose version
chmod 600 .env
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml build app
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml up -d --wait database
```

首次全新部署在空库上执行初始化，将输出的随机初始凭据保存到密码管理器。

```sh
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml run --rm --no-deps app node --import tsx scripts/data.ts init
```

从本机迁移的部署，在空库上执行导入来完成数据准备。例如，将备份放入仅部署人员可访问的目录，并允许容器内的 `node` 用户只读访问该文件。

```sh
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml run --rm --no-deps -v "$PWD/classroom-export.json:/restore/classroom.json:ro" app node --import tsx scripts/data.ts import /restore/classroom.json
```

数据准备完成后启动应用，在服务器本机读取健康状态。`ps` 应显示 `database` 和 `app` 健康，应用端口为 `127.0.0.1:3410->3410/tcp`。

```sh
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml up -d --wait database app
curl --fail --silent --show-error http://127.0.0.1:3410/healthz
docker compose --env-file .env -f deploy/compose.yaml -f deploy/prepare.yaml ps
```

### 备案完成后启用站点

以下代理启动命令适用于本项目独占 80、443 端口的部署。共享服务器已有 HTTPS 代理时，应将学生、教师及根域路由接入现有代理，并验证其到应用的私有网络连接；先保存和验证代理配置的恢复副本，再启用候选配置。此时不要启动本模板的第二个 `proxy` 服务。

在 DNS 控制台为根域 `@` 和 `student`、`teacher`、`library`、`lab` 四个子域配置服务器公网地址。逐个核对 A 记录和已有 AAAA 记录，确保它们均指向实际提供服务的地址。确认 `BASE_DOMAIN` 与 DNS 一致，服务器出站可访问证书服务，安全组及主机防火墙允许 TCP 80、443，且这两个端口可供 Caddy 绑定。

首次启用前用独立容器验证 Caddy 候选配置。该验证命令完成后容器退出。

```sh
docker compose --env-file .env -f deploy/compose.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml run --rm --no-deps proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

正式启动使用基础配置，Compose 会重建应用容器并移除准备阶段的回环端口映射，再启动 HTTPS 代理。数据库沿用现有数据卷。

```sh
docker compose --env-file .env -f deploy/compose.yaml up -d --wait database app
docker compose --env-file .env -f deploy/compose.yaml up -d --wait proxy
docker compose --env-file .env -f deploy/compose.yaml ps
```

Caddy 为根域和模板内四个子域申请 HTTPS 证书。根域会跳转到学生门户，并保留路径和查询参数。核对证书与根域跳转，再用普通学生和教师完成登录、上传截图、分配授权、放大查看和撤权验证。此时对外发布 80、443，PostgreSQL 和应用端口仅在容器网络内使用。

## 可选的旧演示兼容

当前学生页签展示截图图库。应用默认只启动门户与教师服务，旧图书、实验室子进程在有效的 `launch` 票据兑换时按需启动。既有会话、启动票据和旧业务数据保留兼容能力。

维护既有动态演示集成时，可继续通过 `TARGETS_FILE` 提供私网 HTTP(S) 上游，配置对应的独立子域、DNS 和 Caddy 路由，并使系统嵌入策略允许学生门户。后台新增系统使用资料表单，动态客户端由已有接入代码调用 `launch` 完成换票。

```json
[
  {
    "key": "inventory",
    "name": "库存管理",
    "upstream": "http://inventory:8080"
  }
]
```

上游应只接受网关私网连接，并使用网关注入的 `X-Classroom-User-Id` 获取身份。网关逐次检查登录会话、系统上架状态和授权，兼容同源相对地址的 HTTP 页面、静态资源、JSON 与表单接口，单次上行正文上限为 2 MiB。旧系统自行处理写操作的一次性请求编号，依赖独立登录 Cookie、跨域跳转或 WebSocket 的集成需要对应适配。截图图库通过同源图片接口直接读取数据库中的展示图和缩略图。

## 验证与开发

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Windows 下可直接执行 `.\classroom.ps1 check`、`.\classroom.ps1 test` 和 `.\classroom.ps1 build`。如本机已安装 Chrome，PowerShell 可设置 `$env:CHROMIUM_CHANNEL='chrome'`，随后运行 `.\classroom.ps1 browser`。脚本直接调用 Node，可以在 Windows 环境变量较长时使用。测试运行器创建临时数据库，使用随机账户密码，启动独立服务进程，完成后正常关闭。可设置 `CLASSROOM_TEST_PORT` 和 `CLASSROOM_QA_OUTPUT` 选择测试端口及截图位置。存储测试默认使用 PGlite，`CLASSROOM_TEST_DATABASE_URL` 可指向专用的空 PostgreSQL 测试库。

开发运行 `npm run dev`，生产构建后运行 `npm start`。学生门户、教师后台使用 Next.js Pages Router、React 和 Tailwind。tRPC 处理查询和写入，Drizzle 连接 PGlite 或 PostgreSQL，Sharp 生成截图展示图和缩略图，Better Auth 的密码组件处理哈希和校验。会话、请求编号和旧版启动票据由网关与数据库管理。浏览器验收覆盖图库上传、分组、排序、删除、学生访问隔离与撤权。

登录和写操作先领取绑定主机、当前会话与操作的 `X-Request-ID`，有效期 5 分钟。登录前绑定匿名会话，图片上传和资料管理在同一个事务里核销编号并写入数据。旧版启动票据绑定目标系统，有效期 30 秒，通过 POST 兑换。学生退出、停用、重置密码或被撤权后，关联会话按对应范围失效。图片接口通过会话和逐系统授权校验，并返回 `private, no-store` 缓存策略。
