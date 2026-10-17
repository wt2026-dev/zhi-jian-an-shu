# 智检安枢——数字孪生驱动的工业装备检修与安全管控一体化平台 (Industrial Ops Maintenance System)
## 生产部署与环境配置完整说明文档 (README-DEPLOY.md)

本文档面向工业现场运维工程师、DevOps 团队及系统管理员，详细说明本系统的**环境变量配置与密钥申请指引**、**AI 模型路由**、**全链路功能架构**以及**生产环境部署操作步骤**。

> 技术栈基准（与代码实现一致）：Node.js 20 + Express 4 + TypeScript + React 19 / Vite 前端；数据层为 **PGlite（嵌入式 PostgreSQL）**，默认连接串 `pglite://./data/industrial_ops_pg`，生产可切换独立 PostgreSQL（`DB_TYPE=postgres`）；AI 能力统一走**阿里云百炼 DashScope（OpenAI 兼容模式）**，对话模型 `qwen-plus`、视觉模型 `qwen-vl-max`，并支持在管理端配置多模型路由与自动降级。

---

## 目录
1. [系统环境要求与架构概览](#一系统环境要求与架构概览)
2. [环境变量配置与密钥申请详解](#二环境变量配置与密钥申请详解)
   - [2.1 阿里云百炼 DashScope API Key 申请（对话 qwen-plus / 视觉 qwen-vl-max）](#21-阿里云百炼-dashscope-api-key-申请)
   - [2.2 JWT 认证安全令牌密钥生成](#22-jwt-认证安全令牌密钥生成)
   - [2.3 数据库与持久化存储参数](#23-数据库与持久化存储参数)
3. [AI 模型路由与多模型降级](#三ai-模型路由与多模型降级)
4. [部署操作步骤](#四部署操作步骤)
   - [4.1 方式一：Node.js 原生生产部署](#41-方式一nodejs-原生生产部署)
   - [4.2 方式二：PM2 生产守护进程部署](#42-方式二pm2-生产守护进程部署)
   - [4.3 方式三：Docker 容器化部署](#43-方式三docker-容器化部署)
   - [4.4 方式四：Docker Compose 编排（含 PostgreSQL 与自动备份）](#44-方式四docker-compose-编排含-postgresql-与自动备份)
5. [Nginx 反向代理与安全配置](#五nginx-反向代理与安全配置)
6. [RBAC 角色权限与接口防护说明](#六rbac-角色权限与接口防护说明)
7. [可选外部服务配置](#七可选外部服务配置)
   - [7.1 Agnes AI 视频生成（AGNES_BASE_URL / AGNES_API_KEY）](#71-agnes-ai-视频生成)
   - [7.2 魔珐星云 3D 数字人（XINGYUN_APP_ID / XINGYUN_APP_SECRET）](#72-魔珐星云-3d-数字人)
   - [7.3 微信小程序（WECHAT_APP_ID / WECHAT_APP_SECRET）](#73-微信小程序)
8. [常见故障排查与运维诊断 (FAQ)](#八常见故障排查与运维诊断-faq)
9. [PostgreSQL 生产部署已验证](#九postgresql-生产部署已验证)

---

## 一、系统环境要求与架构概览

- **操作系统**：Linux (Ubuntu 20.04/22.04 LTS, Debian 11+) 或 macOS / Windows Server
- **Node.js 运行时**：Node.js >= 20（推荐 LTS v20.x / v22.x）
- **包管理工具**：npm (>= 9.x)
- **硬件最低配置**：
  - CPU: 2 核及以上
  - 内存: 4GB 及以上（前端静态构建 + Node.js 运行时 + 嵌入式数据库）
  - 磁盘: 20GB 以上可用空间（`data/` 存储 PGlite 数据库文件、`public/uploads/` 存储缺陷图片与检修视频）
- **架构概览**：单进程全栈单体——Express 同时提供 REST API / SSE 流式接口 / 前端静态资源托管；数据默认写入本地 PGlite（零外部依赖，开箱即用）；生产可平滑切换独立 PostgreSQL。

---

## 二、环境变量配置与密钥申请详解

生产环境中请将根目录下的 `.env.example` 复制为 `.env`：
```bash
cp .env.example .env
```

### 2.1 阿里云百炼 DashScope API Key 申请
- **配置项名称**：`DASHSCOPE_API_KEY`（可选关联项：`DASHSCOPE_BASE_URL`、`DASHSCOPE_MODEL`、`DASHSCOPE_VISION_MODEL`）
- **关联功能**：
  1. **qwen-plus 对话模型**：智能问答、故障诊断、检修方案生成、派单推荐、报告生成等 20 项 AI 能力（其中 7 项支持 SSE 流式输出，OpenAI 兼容模式调用）。
  2. **qwen-vl-max 视觉模型**：工业现场缺陷照片的多模态识别与质检（点蚀、裂纹、密封失效等）。
- **密钥申请详细步骤**：
  1. 访问 **阿里云百炼控制台**：[https://dashscope.console.aliyun.com/](https://dashscope.console.aliyun.com/)
  2. 登录阿里云账号（未注册用户先完成实名认证）。
  3. 在左侧导航栏点击 **「API-KEY 管理」**（或直接访问 [https://dashscope.console.aliyun.com/apiKey](https://dashscope.console.aliyun.com/apiKey)）。
  4. 点击 **「创建新的 API-KEY」**，填写备注（如：`industrial-inspection-prod`）。
  5. 复制生成的以 `sk-` 开头的 API Key，填入 `.env` 的 `DASHSCOPE_API_KEY`。
  6. **默认模型**：`DASHSCOPE_MODEL=qwen-plus`、`DASHSCOPE_VISION_MODEL=qwen-vl-max`（可在 `.env` 中覆盖）。
  7. **多模型扩展**：除 `.env` 外，还可在系统管理端「AI 模型路由」中接入任意 OpenAI 兼容模型（DeepSeek、通义千问系列等）并配置降级顺序，详见[第三章](#三ai-模型路由与多模型降级)。

### 2.2 JWT 认证安全令牌密钥生成
- **配置项名称**：`JWT_SECRET`（**必填**，缺失时服务拒绝启动 fail-fast）
- **用途**：全链路无状态 JWT 认证——签发与校验用户身份、角色标识；同时派生 AI 模型配置中明文 API Key 的加密密钥。
- **推荐生成命令**：
  ```bash
  openssl rand -hex 32
  ```
  将输出结果填入 `.env` 中的 `JWT_SECRET`，例如：
  ```env
  JWT_SECRET="<请用 openssl rand -hex 32 自行生成强随机密钥>"
  ```

### 2.3 数据库与持久化存储参数
| 环境变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `NODE_ENV` | `development` | 运行环境模式（`production` 时优先尝试独立 PostgreSQL） |
| `PORT` | `3000` | 服务监听端口 |
| `JWT_SECRET` | （无，必填） | JWT 签名密钥，见 2.2 |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000, http://127.0.0.1:3000, http://localhost:5173, http://127.0.0.1:5173` | 跨域白名单（逗号分隔） |
| `DATABASE_URL` | `pglite://./data/industrial_ops_pg` | 嵌入式 PGlite 数据库连接串；填 `postgres://...` 时切换独立 PostgreSQL |
| `DB_TYPE` | `pglite` | 数据库引擎（`pglite` / `postgres`）；生产建议 `postgres` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `localhost` / `5432` / `industrial_maintenance` / `postgres` / 空 | 仅 `DB_TYPE=postgres` 时生效；连接失败自动平滑降级回 PGlite |
| `DB_POOL_MAX` | `10` | PostgreSQL 连接池上限 |
| `LOG_LEVEL` | `info` | pino 日志级别（trace~fatal），日志文件自动轮转 |
| `DASHSCOPE_API_KEY` | 空 | 阿里云百炼密钥，缺失时 AI 功能按规则引擎友好降级 |
| `XINGYUN_APP_ID` / `XINGYUN_APP_SECRET` | 空 | 魔珐星云 3D 数字人（可选，见第七章） |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 空 | 微信小程序太阳码（可选，见第七章） |
| `AGNES_BASE_URL` / `AGNES_API_KEY` | 内置默认值 / 空 | Agnes AI 检修视频生成（可选，见第七章） |

> 说明：数据库为 **17 个幂等迁移、共 27 张业务表**（编号 001–017，详见 README.md「数据库表」）。首次启动自动执行全部迁移；`users` 表为空时自动导入种子数据（含默认账号 admin）。

---

## 三、AI 模型路由与多模型降级

系统管理员可在 **系统管理 → AI 模型路由** 中管理多个 OpenAI 兼容模型：

- **能力类型**：`chat`（对话/文本）、`vision`（视觉）、`video`（视频，预留）。
- **降级顺序**：按优先级升序依次尝试；仅当失败属于 **超时 / 网络错误 / 5xx / 鉴权失败（401/403）** 时自动切换下一候选，其余错误（如参数错误）原样抛出。
- **健康状态**：每次调用成功/失败异步回写健康状态；管理端可对任一配置执行「测试连接」（真实调用一次，返回耗时）。
- **密钥安全**：支持明文密钥（AES-256-GCM 加密入库，密钥由 `JWT_SECRET` 派生）或环境变量名引用两种方式；列表接口只返回掩码，不明文回传。
- **可观测性**：模型降级事件写入审计日志（`AI_MODEL_FAILOVER`），配置变更写入 `AI_MODEL_CONFIG_CHANGE`。
- **兼容性**：删除全部配置或未做任何配置时，自动回退 `.env` 中的 `DASHSCOPE_*` 行为，功能不受影响。

---

## 四、部署操作步骤

### 4.1 方式一：Node.js 原生生产部署
```bash
# 1. 克隆代码仓库并进入项目根目录
git clone <your-repository-url>
cd <repository-directory>

# 2. 从环境模板创建生产环境配置文件
cp .env.example .env
# 编辑填入 JWT_SECRET（必填）与 DASHSCOPE_API_KEY 等
nano .env

# 3. 安装项目依赖
npm install

# 4. 执行生产环境打包编译
# （同时构建前端 Vite 静态产物 dist/ 与后端 CommonJS 自包含包 dist/server.cjs）
npm run build

# 5. 启动生产服务
npm start
```
服务启动后，控制台将输出：
```
[Industrial Ops System v2.0.0] Server running at http://0.0.0.0:3000
```
在浏览器中访问 `http://<服务器IP>:3000` 即可登入系统。首次启动自动执行数据库迁移并导入种子数据。

### 4.2 方式二：PM2 生产守护进程部署
```bash
# 1. 全局安装 pm2 进程管理器
npm install -g pm2

# 2. 编译生产代码
npm run build

# 3. 使用 PM2 启动后端服务
pm2 start dist/server.cjs --name "industrial-maintenance-app" --node-args="--max-old-space-size=2048"

# 4. 配置开机自启
pm2 save
pm2 startup

# 5. 查看运行状态与日志
pm2 status
pm2 logs industrial-maintenance-app
```

### 4.3 方式三：Docker 容器化部署
```bash
# 1. 构建 Docker 镜像（多阶段构建：前端构建 + 后端 bundle）
docker build -t industrial-maintenance:latest .

# 2. 运行容器（映射 3000 端口，挂载数据库与上传资源目录实现持久化）
docker run -d \
  --name industrial-app \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/public/uploads:/app/public/uploads \
  --env-file .env \
  --restart always \
  industrial-maintenance:latest

# 3. 检查容器运行状态
docker ps
docker logs -f industrial-app
```

### 4.4 方式四：Docker Compose 编排（含 PostgreSQL 与自动备份）
编排包含：应用服务（资源限制 CPU≤70%、内存≤4G）、PostgreSQL 16（`DB_TYPE=postgres` 时启用）与每日 02:00 自动备份容器：

```bash
# 启动编排服务
docker compose up -d

# 查看服务状态
docker compose ps

# 停止并清理容器
docker compose down
```

---

## 五、Nginx 反向代理与安全配置

工业生产环境中通常使用 Nginx 作为边缘接入网关。以下为推荐的 `nginx.conf` 生产配置片段（已按本系统实际实现调整：请求体上限 120M、SSE 流式接口关闭缓冲）：

```nginx
server {
    listen 80;
    server_name maintenance.your-company.com;

    # 关键配置：允许工业高清照片 / 视频Base64 / 大型报告上传
    # （与后端 express.json({ limit: "120mb" }) 保持一致）
    client_max_body_size 120M;

    # 缺陷图片 / 检修视频静态文件代理与本地缓存
    location /uploads/ {
        alias /data/industrial-app/public/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # AI SSE 流式接口（对话流 / 协同任务事件流）：必须关闭缓冲，否则事件帧会被滞留
    location ~ ^/api/v1/ai/(chat/stream|pipeline/.*/events)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }

    # 其余 API 接口及前端应用主代理
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        # 传递真实客户端 IP（用于接口滑动窗口限流与审计日志准确记录）
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 延长大模型生成与协同任务编排的超时等待时间
        proxy_connect_timeout 90s;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
}
```

---

## 六、RBAC 角色权限与接口防护说明

系统内置 7 种角色（定义于 `src/server/schemas/auth.ts` 的 `createUserSchema` 与 `users` 表，角色种子见 `src/db/seed.ts`），管理端可通过「用户与权限」创建账号并分配：

| 角色 | 角色代号 (role) | 种子角色头衔示例 | 核心权限 |
| :--- | :--- | :--- | :--- |
| **系统管理员** | `admin` | 总工 / 机电部长 | 全部权限；并作为 `requireRole` 的直通角色（任何管理端操作均可执行）：用户管理、AI 模型路由、AI 生成内容审核台、知识贡献/纠错采纳、性能指标等 |
| **维保主管** | `manager` | 车间安全总监 / 维保主管 | 新增设备档案、创建检修作业指引、创建/更新巡检任务、工单派单与执行 |
| **检修技师** | `technician` | 机电检修高级技师 / 电气专工 | 工单执行与完工回填、创建/更新巡检任务、申请备件 |
| **点检员** | `inspector` | 点检工程师 / 巡检主管 | 创建/更新巡检任务、隐患排查上报 |
| **现场操作工** | `operator` | 现场生产岗位操作工 | 设备状态监视、扫码报修 |
| **吊装操作岗** | `user` | 吊装司机 / 起重机械操作岗 | 基础浏览与报修 |
| **档案管理员** | `archivist` | 档案管理员 / 检修知识库专员 | 知识库审核（approve/reject）、知识图谱抽取 |

### 接口安全防护机制（与代码实现一致）
1. **RBAC 鉴权拦截**：管理端接口（AI 内容审核、模型路由、性能指标等）统一 `requireRole(["admin"])`；知识审核类为 `admin`/`archivist`；巡检任务创建/更新为 `inspector`/`admin`/`manager`/`technician`；新增设备档案与检修作业指引为 `admin`/`manager`。未授权调用返回 `403 RBAC_PERMISSION_DENIED` 并写审计日志。
2. **滑动窗口限流（按 IP）**：`/api/v1/*` 全局 240 次/分钟；登录接口 20 次/分钟；AI 接口 60 次/分钟。超限返回 429 并附 `Retry-After` 响应头。
3. **登录防爆破**：连续失败 5 次锁定该 IP 15 分钟（`IP_LOCKED`）。
4. **JWT 鉴权**：除公开健康检查与 legacy 兼容端点外均需 `Bearer Token`；登出后 Token 进入黑名单立即失效。
5. **操作审计**：登录、工单流转、作业票审批、AI 模型变更/降级、AI 内容审核等全量写入 `audit_logs`（管理端可查询）。

---

## 七、可选外部服务配置

以下服务均为**可选增强**：未配置时系统自动降级，核心业务不受影响。**严禁在任何文档、代码仓库中写入真实密钥值。**

### 7.1 Agnes AI 视频生成
- **环境变量**：`AGNES_BASE_URL`（默认 `https://apihub.agnes-ai.cn/v1`，一般无需修改）、`AGNES_API_KEY`
- **实际用途**：为「标准化检修作业指引」生成 AI 演示视频——`POST /api/v1/procedures/:id/generate-video`、`generate-video-full` 调 Agnes 生成，`GET /api/v1/procedures/video-status` 轮询生成进度。
- **申请方式**：联系 Agnes AI 开放平台（apihub.agnes-ai.cn）开通账号并获取 API Key；在 `.env` 中新增 `AGNES_API_KEY=sk-xxxx`（如需自定义网关再新增 `AGNES_BASE_URL`）。注：`.env.example` 中暂未预置这两项，手动添加即可生效（服务端 `src/server/utils/config.ts` 会自动读取）。
- **缺失时的降级行为**：相关接口返回明确的 `AGNES_API_KEY 缺失` 提示（HTTP 200 携带 error 字段），指引文本与步骤不受影响，仅无法生成视频。

### 7.2 魔珐星云 3D 数字人
- **环境变量**：`XINGYUN_APP_ID`、`XINGYUN_APP_SECRET`
- **实际用途**：AI 数字人助手的 3D 渲染与语音驱动——`POST /api/v1/xingyun/session` 由服务端代理换取星云会话凭证（AppId/Secret 只存在于服务端，严禁暴露前端）；`GET /api/v1/digital-human/status` 返回配置状态。
- **申请方式**：在魔珐星云开放平台（xingyun.mofa.ai）创建应用，获取 AppID 与 AppSecret 填入 `.env`。
- **缺失时的降级行为**：`digital-human/status` 返回未配置提示；数字人自动降级为 **2D 仿真形态**（本地驱动），对话问答能力不受影响。

### 7.3 微信小程序
- **环境变量**：`WECHAT_APP_ID`、`WECHAT_APP_SECRET`
- **实际用途**：设备专属报修「小程序太阳码」生成——`POST /api/v1/wechat/token` 由服务端获取 access_token（带内存缓存），`GET /api/v1/wechat/repair-qrcode` 调用微信 `getwxacodeunlimit` 生成太阳码；配合 `miniprogram/` 小程序端实现扫码免登录报修（`POST /api/v1/wx/repairs`）。
- **申请方式**：在微信公众平台注册小程序，于「开发管理 → 开发设置」获取 AppID/AppSecret，并将服务器出口 IP 加入小程序后台 IP 白名单后填入 `.env`。
- **缺失时的降级行为**：太阳码接口返回未配置提示并**自动降级为 H5 报修二维码**，扫码报修全流程可继续使用。

---

## 八、常见故障排查与运维诊断 (FAQ)

### Q1: 浏览器点击录音麦克风提示"权限未授权"或无响应？
- **原因**：现代浏览器（Chrome、Edge、Safari）的安全策略要求麦克风音频采集必须运行在 **HTTPS 协议** 或 `http://localhost` 本地环回地址下。若直接使用内网 HTTP IP 访问，浏览器会默认阻断录音设备访问。
- **解决办法**：
  1. 为 Nginx 配置 SSL/TLS 证书（Let's Encrypt 或企业自签证书）。
  2. 当前版本的 DashScope 兼容模式暂不支持语音转写：`POST /api/v1/ai/speech-to-text` 会返回 `success:false` 与"暂不支持"提示（前端已有明确文案），语音录入属预留能力。

### Q2: 上传高清现场设备照片提示 413 Request Entity Too Large？
- **原因**：前端/Nginx 默认限制客户端请求 Body 大小（Nginx 默认 1MB）。
- **解决办法**：
  1. 后端 Express 已将解析上限设置为 `120mb`（`express.json({ limit: "120mb" })`，用于视觉大图与视频 Base64）。
  2. 请同步在 Nginx `server` 块配置 `client_max_body_size 120M;`（见第五章）。

### Q3: 没有配置 DASHSCOPE_API_KEY 时系统会报错吗？
- **回答**：不会崩溃。系统内置**工业专家规则引擎降级**：AI 接口返回 HTTP 200 并携带 `degraded: true` 标记与规则引擎结果（不伪造 AI 原生输出，如实标注降级来源）；驾驶舱、工单、巡检等核心业务流程不依赖 AI，完全可用。配置密钥后即刻生效（模型路由配置有 5 秒缓存）。

### Q4: 如何排查 AI 调用失败或模型切换？
- **回答**：
  1. 管理端「AI 模型路由」查看每条配置的健康状态与最近检测时间，可对任一配置点击「测试连接」。
  2. 审计日志中检索 `AI_MODEL_FAILOVER`（模型自动切换）与 `AI_MODEL_CONFIG_CHANGE`（配置变更）。
  3. 首次接入新模型建议先点「测试连接」确认连通性，再启用并参与路由。

### Q5: 服务启动时抛出"环境变量 JWT_SECRET 未配置，拒绝启动"？
- **回答**：这是刻意的 fail-fast 安全设计。按 2.2 节生成强随机密钥写入 `.env` 后重启即可。

---

## 九、PostgreSQL 生产部署已验证

> 本系统已于 2026-09-14 在真实 PostgreSQL 16.15 实例上完成全链路验证，详见 `docs/生产模式验证报告.md`。

### 验证结论

- **23 个迁移文件**在真 PG 上全部执行成功，零兼容性问题；**数据迁移工具**覆盖全量 29 张业务表
- **种子数据**11 类（用户/设备/工单/作业票/通知/审计日志/知识库/巡检/遥测/工单日志/LOTO 锁具）全部写入
- **29 张业务表**结构完整
- **核心测试 15/15 全部通过**：工单状态机 (6) + RBAC 权限 (2) + 并发乐观锁 (7)
- **PGlite 回归 33 文件 / 237 用例全部通过**，双模式互不影响

### 切换到 PostgreSQL 生产模式

```bash
# .env 中修改两行即可切换
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/industrial_maintenance"
DB_TYPE=postgres
```

### 快速复现验证

```bash
# 1. 启动 PG 16 容器
docker run -d --name pg16 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=industrial_maintenance -p 5432:5432 postgres:16-alpine

# 2. 配置 .env（见上）

# 3. 迁移 + 种子 + 测试
npm run db:migrate && npm run db:seed
npx vitest run tests/work-order-state-machine.test.ts tests/rbac.test.ts tests/optimistic-lock-and-concurrency.test.ts
```

### 双模式兼容性说明

系统使用标准 PostgreSQL 语法编写所有迁移 SQL，PGlite 0.5.x（嵌入式 PG）与独立 PostgreSQL 16 均原生支持。`vectorStore.ts` 自动探测 pgvector 扩展：真 PG 安装 pgvector 后启用 HNSW 向量索引，PGlite 无 pgvector 时自动降级为 JSONB 余弦相似度（功能完整，性能对参赛规模足够）。
