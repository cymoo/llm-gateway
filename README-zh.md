# LLM Gateway

一个基于 **Next.js 16** + **Drizzle ORM** + **PostgreSQL** 的 LLM 网关项目，提供：

- 统一的大模型代理入口（兼容 OpenAI 风格 `chat.completions`）
- 用户与模型权限管理
- 用户/模型配额与限流控制
- 使用量统计（usage logs / daily usage）
- 管理后台（管理员登录后进行模型与用户管理）

## 语言版本

- English: `README.md`
- 中文: `README-zh.md`（本文件）

## 技术栈

- **Web 框架**: Next.js `16.1.7`（App Router）
- **语言**: TypeScript
- **数据库**: PostgreSQL
- **ORM**: Drizzle ORM + Drizzle Kit
- **认证**: JWT（`jose`）+ Cookie
- **密码加密**: `bcryptjs`
- **UI**: React 19 + Tailwind CSS 4 + Radix UI

## 快速开始

### 1) 安装依赖

```bash
npm ci
```

### 2) 配置环境变量（`.env`）

```env
# PostgreSQL 连接串（必填）
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/llm_gateway

# 默认管理员（可选，但建议配置）
ADMIN_EMAIL=admin@example.com
ADMIN_NAME=System Admin
ADMIN_PASSWORD=ChangeMe123!

# JWT 密钥（生产环境建议配置高强度值）
JWT_SECRET=replace-with-a-long-random-secret

# 代理超时（毫秒，可选）
PROXY_TIMEOUT_NON_STREAM=300000
PROXY_TIMEOUT_STREAM=600000
```

### 3) 初始化数据库

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

如 PostgreSQL 未启用 `pgcrypto`，请先执行：

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 4) 启动开发环境

```bash
npm run dev
```

默认访问：`http://localhost:3000`

## 默认管理员初始化说明（seed）

管理员并不是在启动时立即创建，而是由 `src/lib/db/seed.ts` 在首次请求以下任一接口时触发：

- `POST /api/admin/auth/login`
- `POST /api/v1/chat/completions`

仅当以下三个环境变量都存在时才会尝试创建：

- `ADMIN_EMAIL`
- `ADMIN_NAME`
- `ADMIN_PASSWORD`

若数据库中已存在管理员（`is_admin=true`），则不会重复创建。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
npm run start
```
