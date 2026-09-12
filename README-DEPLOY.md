# 工业设备智能检修与作业协同系统 (Industrial Ops Maintenance System)
## 生产部署与环境配置完整说明文档 (README-DEPLOY.md)

本文档面向工业现场运维工程师、DevOps 团队及系统管理员，详细说明本系统的**环境变量密钥申请指引**、**全链路功能架构**以及**生产环境部署操作步骤**。

---

## 目录
1. [系统环境要求与架构概览](#一系统环境要求与架构概览)
2. [环境变量配置与密钥申请详解](#二环境变量配置与密钥申请详解)
   - [2.1 阿里云灵积 DashScope API Key 申请 (视觉缺陷 + 语音识别)](#21-阿里云灵积-dashscope-api-key-申请)
   - [2.2 Google Gemini API Key 申请 (智能诊断 + 知识检索)](#22-google-gemini-api-key-申请)
   - [2.3 JWT 认证安全令牌密钥生成](#23-jwt-认证安全令牌密钥生成)
   - [2.4 数据库与持久化存储参数](#24-数据库与持久化存储参数)
3. [部署操作步骤](#三部署操作步骤)
   - [3.1 方式一：Node.js 原生生产部署 (推荐开箱即用)](#31-方式一nodejs-原生生产部署)
   - [3.2 方式二：PM2 生产守护进程部署 (高可用生产)](#32-方式二pm2-生产守护进程部署)
   - [3.3 方式三：Docker 容器化部署](#33-方式三docker-容器化部署)
   - [3.4 方式四：Docker Compose 全栈一键编排](#34-方式四docker-compose-全栈一键编排)
4. [Nginx 反向代理与安全配置](#四nginx-反向代理与安全配置)
5. [RBAC 角色权限与接口防护说明](#五rbac-角色权限与接口防护说明)
6. [常见故障排查与运维诊断 (FAQ)](#六常见故障排查与运维诊断-faq)

---

## 一、系统环境要求与架构概览

- **操作系统**：Linux (Ubuntu 20.04/22.04 LTS, CentOS 7.9+, Debian 11+) 或 macOS / Windows Server
- **Node.js 运行时**：Node.js >= 18.18.0 (推荐 LTS v20.x 或 v22.x)
- **包管理工具**：npm (>= 9.x) 或 pnpm / yarn
- **硬件最低配置**：
  - CPU: 2 核及以上
  - 内存: 4GB 及以上（包含前端静态编译与 Node.js 运行时）
  - 磁盘: 20GB 以上可用空间（用于挂载 `/uploads` 缺陷图片存储与 SQLite 本地数据库）

---

## 二、环境变量配置与密钥申请详解

生产环境中请将根目录下的 `.env.example` 复制为 `.env`：
```bash
cp .env.example .env
```

以下为各项环境变量的用途与申请指引：

### 2.1 阿里云灵积 DashScope API Key 申请
- **配置项名称**：`DASHSCOPE_API_KEY`
- **关联功能**：
  1. **Qwen-VL-Plus 工业多模态视觉大模型**：现场手持内窥镜、缺陷照片（点蚀、裂纹、密封失效）的毫米级缺陷智能判损与定级。
  2. **Paraformer-v1 工业高抗噪语音大模型**：对讲机现场语音录音转写为结构化工单要素。
  3. **Qwen-Max 工业知识对话模型**：规程查询与 RAG 检索。
- **密钥申请详细步骤**：
  1. 使用浏览器访问 **阿里云百炼 / 灵积模型服务控制台**：[https://dashscope.console.aliyun.com/](https://dashscope.console.aliyun.com/)
  2. 登录阿里云账号（未注册用户先完成实名认证）。
  3. 在左侧导航栏点击 **「API-KEY 管理」** (或直接访问 [https://dashscope.console.aliyun.com/apiKey](https://dashscope.console.aliyun.com/apiKey))。
  4. 点击 **「创建新的 API-KEY」**，填写密钥备注（如：`industrial-inspection-prod`）。
  5. 复制生成的以 `sk-` 开头的 API Key，将其填入 `.env` 文件中的 `DASHSCOPE_API_KEY`。
  6. **免费额度说明**：阿里云百炼新用户默认赠送包含千问多模态及语音 Paraformer 的免费代金券，开箱即用。

### 2.2 Google Gemini API Key 申请
- **配置项名称**：`GEMINI_API_KEY`
- **关联功能**：
  1. 工业旋转机组（泵、减速机、电机、压缩机）多维故障树智能诊断。
  2. 振动频谱特征与红外热像数据综合根因推演。
- **密钥申请详细步骤**：
  1. 访问 **Google AI Studio**：[https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
  2. 登录 Google 账号。
  3. 点击 **「Create API key」** 按钮。
  4. 选择或新建一个 Google Cloud 项目。
  5. 复制生成的 API Key，填入 `.env` 文件的 `GEMINI_API_KEY` 中。

### 2.3 JWT 认证安全令牌密钥生成
- **配置项名称**：`JWT_SECRET`
- **用途**：系统采用全链路无状态 JWT 认证体系，签名生成与校验用户身份、角色标识及权限列表。
- **推荐生成命令**：
  在 Linux 或 macOS 终端中执行以下命令生成高强度的 256 位加密随机字符串：
  ```bash
  openssl rand -hex 32
  ```
  将输出结果填入 `.env` 中的 `JWT_SECRET`，例如：
  ```env
  JWT_SECRET="<请用 openssl rand -hex 32 自行生成强随机密钥>"
  ```

### 2.4 数据库与持久化存储参数
| 环境变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | 运行环境模式 (`production` / `development`) |
| `PORT` | `3000` | 后端服务监听端口 |
| `APP_URL` | `http://localhost:3000` | 对外服务访问基础地址 |
| `DATABASE_URL` | `sqlite+aiosqlite:///./industrial_maintenance.db` | 默认本地轻量级数据库，支持开箱即用；生产环境支持切换至 PostgreSQL |
| `REDIS_URL` | `redis://localhost:6379/0` | (选配) Redis 缓存与分布式限流地址 |

---

## 三、部署操作步骤

### 3.1 方式一：Node.js 原生生产部署
最快速轻量的部署方式：

```bash
# 1. 克隆代码仓库并进入项目根目录
git clone <your-repository-url>
cd <repository-directory>

# 2. 从环境模板创建生产环境配置文件
cp .env.example .env
# 编辑填入申请好的真实 DASHSCOPE_API_KEY 或 GEMINI_API_KEY
nano .env

# 3. 安装项目依赖
npm install

# 4. 执行生产环境打包编译
# (同时构建前端 Vite 静态产物 dist/ 与 后端 CommonJS 自包含包 dist/server.cjs)
npm run build

# 5. 启动生产服务
npm start
```
服务启动后，控制台将输出：
```
Server running on http://0.0.0.0:3000
```
在浏览器中访问 `http://<服务器IP>:3000` 即可登入系统。

---

### 3.2 方式二：PM2 生产守护进程部署
适用于需要进程保活、崩溃自动重启与日志持久化的正式生产环境：

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

---

### 3.3 方式三：Docker 容器化部署
利用工程根目录的 `Dockerfile` 构建无外部依赖的独立镜像：

```bash
# 1. 构建 Docker 镜像
docker build -t industrial-maintenance:latest .

# 2. 运行容器 (映射 3000 端口，并挂载缺陷图片持久化目录)
docker run -d \
  --name industrial-app \
  -p 3000:3000 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  --restart always \
  industrial-maintenance:latest

# 3. 检查容器运行状态
docker ps
docker logs -f industrial-app
```

---

### 3.4 方式四：Docker Compose 全栈一键编排
包含后端服务、Redis 与反向代理的集群编排：

```bash
# 启动编排服务
docker compose up -d

# 查看服务状态
docker compose ps

# 停止并清理容器
docker compose down
```

---

## 四、Nginx 反向代理与安全配置

工业生产环境中通常使用 Nginx 作为边缘接入网关，代理 WebSocket、静态上传资源与 API 接口。以下为推荐的 `nginx.conf` 生产配置片段：

```nginx
server {
    listen 80;
    server_name maintenance.your-company.com;

    # 关键配置：允许工业高清内窥镜照片/视觉缺陷大图上传 (建议设为 50M)
    client_max_body_size 50M;

    # 缺陷图片上传静态文件代理与本地缓存
    location /uploads/ {
        alias /data/industrial-app/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # API 接口及前端应用主代理
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # 保持连接与 WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # 传递真实客户端 IP (用于接口滑动窗口限流与审计日志准确记录)
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 延长长语音转写与多模态大模型超时等待时间
        proxy_connect_timeout 90s;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
}
```

---

## 五、RBAC 角色权限与接口防护说明

系统已内置严格的企业级细粒度角色访问控制（RBAC）：

| 角色分类 | 角色代号 (Role) | 核心权限与作业限制 |
| :--- | :--- | :--- |
| **系统管理员** | `admin` | 拥有全部权限，可管理用户角色、查看审计日志、增删各类资产与作业票。 |
| **安全总监 / 安全员** | `inspector` | 拥有高危作业票审批、归档、注销删除权限；巡检与隐患排查。 |
| **维保工程师 / 技术员** | `technician` | 拥有工单执行、回填检修工时、申请备件、申请高危作业票权限。**禁止删除高危作业票**。 |
| **车间普通操作员** | `operator` / `user` | 设备运行状态监视、缺陷报修上报。**禁止删除任何高危作业票与能量隔离锁**。 |

### 接口安全防护机制
1. **RBAC 鉴权拦截**：在 `DELETE /api/v1/safety-permits/:id` 等危险端点设置 `requireRole(['admin', 'inspector'])` 强校验；普通操作员调用将立即返回 `403 Forbidden` 并触发安全事件告警。
2. **滑动窗口高频防刷限流 (Rate Limiter)**：
   - 登录接口：限制每个 IP 1 分钟内最多 10 次请求，防御暴力破解。
   - 大模型视觉与语音接口：限制 1 分钟内最多 30 次，保障第三方 Token 额度安全。
3. **操作审计日志持久化 (Audit Logging)**：自动异步记录每一次登录、工单状态流转、高危作业票新增/审批/注销操作的 IP、时间戳、操作人与变更明细。

---

## 六、常见故障排查与运维诊断 (FAQ)

### Q1: 浏览器点击录音麦克风提示“权限未授权”或无响应？
- **原因**：现代浏览器（Chrome、Edge、Safari）的安全策略要求麦克风音频采集必须运行在 **HTTPS 协议** 或 `http://localhost` 本地环回地址下。若直接使用内网 HTTP IP 访问，浏览器会默认阻断录音设备访问。
- **解决办法**：
  1. 为 Nginx 配置 SSL/TLS 证书（通过 Let's Encrypt 或企业自签证书开启 HTTPS）。
  2. 若在安全沙盒环境中测试，界面已内置一键“现场对讲语音快捷填入”测试按钮，可直接验证后端 Paraformer 语音处理管线。

### Q2: 上传高清现场设备照片提示 413 Request Entity Too Large？
- **原因**：前端/Nginx 默认限制客户端请求 Body 大小为 1MB。
- **解决办法**：
  1. 系统 `server.ts` 已将 Express 解析上限提升至 `50mb` (`express.json({ limit: '50mb' })`)。
  2. 请同时检查前端反向代理 Nginx，在 `http` 或 `server` 块中配置 `client_max_body_size 50M;`。

### Q3: 没有配置 DASHSCOPE_API_KEY 时系统会报错吗？
- **回答**：系统内置了**工业专家规则与离线故障字典降级容错机制**。当未配置密钥或网络离线时，系统将自动平滑降级为基于旋转设备振动与磨损机理的专家研判模式，保障工厂现场核心业务流程不中断。
