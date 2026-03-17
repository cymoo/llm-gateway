# LLM Gateway

一个基于 **Next.js 16** + **Drizzle ORM** + **PostgreSQL** 的 LLM 网关项目，提供：

- 统一的大模型代理入口（兼容 OpenAI 风格 `chat.completions`）
- 用户与模型权限管理
- 用户/模型配额与限流控制
- 使用量统计（usage logs / daily usage）
- 管理后台（管理员登录后进行模型与用户管理）

---

## 技术栈

- **Web 框架**: Next.js `16.1.7`（App Router）
- **语言**: TypeScript
- **数据库**: PostgreSQL
- **ORM**: Drizzle ORM + Drizzle Kit
- **认证**: JWT（`jose`）+ Cookie
- **密码加密**: `bcryptjs`
- **UI**: React 19 + Tailwind CSS 4 + Radix UI

---

## 项目结构（核心目录）

```text
src/
├─ app/
│  ├─ api/                    # API 路由（含 /api/v1/chat/completions）
│  └─ admin/                  # 管理后台页面
├─ lib/
│  ├─ auth/                   # JWT 签发/校验
│  ├─ db/                     # Drizzle schema、连接与 seed
│  ├─ proxy/                  # 转发大模型请求
│  ├─ quota/                  # 配额与限流逻辑
│  └─ usage/                  # 使用量记录
└─ middleware.ts
```

---

## 快速开始

### 1) 安装依赖

```bash
npm ci
```

### 2) 配置环境变量（`.env`）

在项目根目录创建 `.env` 文件（示例）：

```env
# PostgreSQL 连接串（必填）
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/llm_gateway

# 默认管理员（可选，但建议配置）
# 对应代码: src/lib/db/seed.ts
ADMIN_EMAIL=admin@example.com
ADMIN_NAME=System Admin
ADMIN_PASSWORD=ChangeMe123!

# JWT 密钥（强烈建议在生产环境配置）
JWT_SECRET=replace-with-a-long-random-secret

# 代理超时（毫秒，可选）
PROXY_TIMEOUT_NON_STREAM=300000
PROXY_TIMEOUT_STREAM=600000
```

> 说明：
> - `DATABASE_URL` 在 `src/lib/db/index.ts` 和 `drizzle.config.ts` 中使用。
> - 默认管理员读取自 `src/lib/db/seed.ts`：`ADMIN_EMAIL`、`ADMIN_NAME`、`ADMIN_PASSWORD`。

### 3) 初始化数据库

本项目使用 Drizzle 管理 PostgreSQL schema。首次初始化建议执行：

```bash
# 1. 生成迁移文件
npx drizzle-kit generate

# 2. 执行迁移
npx drizzle-kit migrate
```

> 如果你的 PostgreSQL 实例未启用 `pgcrypto`，请先执行：
>
> ```sql
> CREATE EXTENSION IF NOT EXISTS pgcrypto;
> ```
>
> 因为 schema 使用了 `gen_random_uuid()`。

### 4) 启动开发环境

```bash
npm run dev
```

默认访问：`http://localhost:3000`

---

## 默认管理员初始化说明（seed）

管理员并不是在启动时立即创建，而是由 `src/lib/db/seed.ts` 在**首次请求**以下接口时触发：

- `POST /api/v1/chat/completions`

触发逻辑位于：`src/app/api/v1/chat/completions/route.ts`

seed 规则：

1. 当 `.env` 中 **同时存在** `ADMIN_EMAIL`、`ADMIN_NAME`、`ADMIN_PASSWORD` 时才会尝试创建。
2. 若数据库中已存在管理员（`is_admin=true`），则不会重复创建。
3. 首次创建时会自动：
   - 使用 bcrypt 哈希密码
   - 生成 `sk-` 前缀 API Key

如需手动触发一次 seed（开发环境示例）：

```bash
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"test","messages":[{"role":"user","content":"ping"}]}'
```

---

## 运行与构建

```bash
# 开发
npm run dev

# 代码检查
npm run lint

# 生产构建
npm run build

# 生产启动
npm run start
```

---

## 部署说明

### 通用 Node.js 部署

1. 准备 PostgreSQL 并确保可访问。
2. 在服务器设置 `.env`（至少包含 `DATABASE_URL`、`JWT_SECRET`，建议配置管理员变量）。
3. 安装依赖并构建：

```bash
npm ci
npx drizzle-kit generate
npx drizzle-kit migrate
npm run build
```

4. 启动服务：

```bash
npm run start
```

### Vercel 部署（可选）

- 可直接部署 Next.js 应用。
- 在项目环境变量中配置与 `.env` 相同的键值。
- 首次上线后，先完成数据库迁移，再触发一次 `/api/v1/chat/completions` 以完成管理员 seed。

---

## 常见问题

### 1) 启动后无法连接数据库

- 检查 `DATABASE_URL` 是否正确
- 检查数据库网络访问权限与防火墙
- 确认目标数据库已创建

### 2) 无法登录管理后台

- 确认已配置 `ADMIN_EMAIL`、`ADMIN_NAME`、`ADMIN_PASSWORD`
- 确认已触发过一次 `POST /api/v1/chat/completions`，让 seed 执行
- 使用 `ADMIN_EMAIL` + `ADMIN_PASSWORD` 登录

### 3) 生产环境安全建议

- 必须设置高强度 `JWT_SECRET`
- 使用 HTTPS 部署
- 定期轮换管理员密码与上游模型密钥

