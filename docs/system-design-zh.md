# LLM Gateway 设计方案

## 一、项目概述

LLM Gateway 是一个基于 Next.js 的 OpenAI 兼容 API 网关，用于统一代理多个 vLLM 后端，提供用户管理、模型授权、用量限额和使用统计功能。

### 核心目标

- 用户通过统一的 `(base_url, model_alias, api_key)` 访问多个 vLLM 后端
- 管理员通过 Web Console 管理用户、模型、授权和限额
- 支持 SSE 流式响应和 tools/function calling 透传
- 按模型粒度控制用户的 token 用量、请求次数和使用时间段

### 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Next.js 15（App Router） |
| 语言 | TypeScript |
| 数据库 | PostgreSQL |
| ORM | Drizzle ORM |
| UI 组件库 | shadcn/ui（Tailwind CSS + Radix UI） |
| 图表 | Recharts |
| 部署方式 | `next start`（standalone 单进程） |
| 认证 | JWT（httpOnly cookie） |

### 约束与规模

- 模型数量：10 个以下
- 并发：100 以下
- 内网环境，API Key 明文存储
- 不涉及计费

---

## 二、系统架构

```
用户 (OpenAI SDK / curl / 任意 HTTP 客户端)
        │
        │  POST /api/v1/chat/completions
        │  POST /api/v1/completions
        │  GET  /api/v1/models
        │  GET  /api/v1/models/{model}
        │  Authorization: Bearer sk-xxxxx
        ▼
┌──────────────────────────────────────────┐
│         LLM Gateway (Next.js 15)         │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │       Admin Console (Web UI)       │  │
│  │  /admin/login                      │  │
│  │  /admin/dashboard                  │  │
│  │  /admin/users                      │  │
│  │  /admin/models                     │  │
│  │  /admin/usage                      │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │    OpenAI-Compatible Proxy Layer   │  │
│  │  /api/v1/*                         │  │
│  │                                    │  │
│  │  1. 认证 (api_key → user)          │  │
│  │  2. 模型解析 (alias → backend)     │  │
│  │  3. 权限检查 (user_models)         │  │
│  │  4. 限额检查 (quotas + usage)      │  │
│  │  5. 请求转发 (rewrite + proxy)     │  │
│  │  6. 响应透传 (SSE / JSON)          │  │
│  │  7. 用量记录 (async)               │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │    Admin API Layer                 │  │
│  │  /api/admin/*                      │  │
│  │  JWT 认证保护                       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │    内存限流器                       │  │
│  │  Map<userId:modelId, timestamps[]> │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │         PostgreSQL                 │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
        │
        │  按 model alias 路由到对应后端
        ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ vLLM: qwen3.5│  │ vLLM: qwen3  │  │ vLLM: ...    │
│ ip1:port1    │  │ ip2:port2    │  │ ipN:portN    │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## 三、数据模型

### 3.1 ER 关系图

```
users ──1:N── user_models ──N:1── models
  │                                  │
  │──1:N── user_model_quotas ──N:1───│
  │
  │──1:N── usage_logs ──N:1── models
  │
  │──1:N── daily_usage ──N:1── models
```

### 3.2 表结构

```sql
-- ============================================
-- 用户表
-- ============================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),               -- 仅 admin 用户需要，普通用户为 NULL
    api_key         VARCHAR(64) UNIQUE NOT NULL, -- 明文存储，格式：sk-<32位随机hex>
    is_active       BOOLEAN DEFAULT true,
    is_admin        BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 模型注册表
-- ============================================
CREATE TABLE models (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alias                           VARCHAR(100) UNIQUE NOT NULL,   -- 用户可见的模型名
    backend_url                     VARCHAR(500) NOT NULL,          -- 如 http://ip1:port1/v1
    backend_model                   VARCHAR(200) NOT NULL,          -- 真实模型名
    backend_api_key                 VARCHAR(200),                   -- 后端 API Key（可选）
    is_active                       BOOLEAN DEFAULT true,

    -- 默认限额模板（新用户授权时自动继承）
    default_max_tokens_per_day      BIGINT,       -- NULL = 不限
    default_max_requests_per_day    INT,          -- NULL = 不限
    default_max_requests_per_min    INT,          -- NULL = 不限
    default_allowed_time_start      TIME,         -- NULL = 不限
    default_allowed_time_end        TIME,         -- NULL = 不限

    created_at                      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 用户-模型授权（多对多）
-- ============================================
CREATE TABLE user_models (
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    model_id    UUID REFERENCES models(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, model_id)
);

-- ============================================
-- 用户-模型限额配置
-- ============================================
CREATE TABLE user_model_quotas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES users(id) ON DELETE CASCADE,
    model_id                UUID REFERENCES models(id) ON DELETE CASCADE,
    max_tokens_per_day      BIGINT,       -- NULL = 不限
    max_requests_per_day    INT,          -- NULL = 不限
    max_requests_per_min    INT,          -- NULL = 不限
    allowed_time_start      TIME,         -- NULL = 不限
    allowed_time_end        TIME,         -- NULL = 不限
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, model_id)
);

-- ============================================
-- 使用日志（详细记录每次请求）
-- ============================================
CREATE TABLE usage_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id),
    model_id            UUID REFERENCES models(id),
    request_type        VARCHAR(50) NOT NULL,     -- "chat.completions" | "completions"
    prompt_tokens       INT DEFAULT 0,
    completion_tokens   INT DEFAULT 0,
    total_tokens        INT DEFAULT 0,
    is_stream           BOOLEAN DEFAULT false,
    duration_ms         INT,
    status              VARCHAR(20),              -- "success" | "error"
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 每日聚合（按用户+模型+日期，加速限额检查）
-- ============================================
CREATE TABLE daily_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    model_id        UUID REFERENCES models(id),
    date            DATE NOT NULL,
    total_tokens    BIGINT DEFAULT 0,
    request_count   INT DEFAULT 0,
    UNIQUE(user_id, model_id, date)
);

-- ============================================
-- 索引
-- ============================================
CREATE INDEX idx_users_api_key ON users(api_key);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_models_alias ON models(alias);
CREATE INDEX idx_usage_logs_user_created ON usage_logs(user_id, created_at);
CREATE INDEX idx_usage_logs_model_created ON usage_logs(model_id, created_at);
CREATE INDEX idx_daily_usage_user_model_date ON daily_usage(user_id, model_id, date);
```

### 3.3 限额检查优先级

```
user_model_quotas 有记录？
    ├── 是 → 使用 user_model_quotas 中的值
    └── 否 → 使用 models 表中的 default_* 值（即模板）
              └── 也为 NULL → 不限制
```

### 3.4 初始管理员 Seed

首次启动时，从环境变量创建管理员：

```
ADMIN_NAME=Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

启动时检查：若 `users` 表中无 `is_admin=true` 的用户，则自动创建。

---

## 四、API 设计

### 4.1 OpenAI 兼容代理接口（`/api/v1/*`）

所有请求通过 `Authorization: Bearer sk-xxxxx` 认证。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/chat/completions` | Chat Completions（支持 stream、tools） |
| `POST` | `/api/v1/completions` | Completions（支持 stream） |
| `GET` | `/api/v1/models` | 返回当前用户被授权的模型列表 |
| `GET` | `/api/v1/models/{model}` | 返回单个模型详情 |
| `GET` | `/api/health` | 健康检查（无需认证） |

#### 请求转发规则

用户发送：
```json
{
  "model": "my-qwen3",
  "messages": [{"role": "user", "content": "hello"}],
  "stream": true,
  "tools": [...]
}
```

Gateway 转发到后端时改写：
```
URL:   http://ip2:port2/v1/chat/completions
Auth:  Bearer <backend_api_key>
Body:  { "model": "qwen3", ... }   ← alias 替换为 backend_model
```

响应原样透传给用户（model 字段保持后端返回的值，不做回写）。

#### 错误响应格式

所有错误统一使用 OpenAI 格式，保证客户端 SDK 兼容：
```json
{
  "error": {
    "message": "具体错误信息",
    "type": "error_type",
    "code": "error_code"
  }
}
```

| 场景 | HTTP 状态码 | type | code |
|------|------------|------|------|
| API Key 无效或缺失 | 401 | `authentication_error` | `invalid_api_key` |
| 用户已禁用 | 403 | `permission_error` | `user_disabled` |
| 无权访问该模型 | 403 | `permission_error` | `model_not_allowed` |
| 模型不存在 | 404 | `not_found_error` | `model_not_found` |
| 每日 token 超限 | 429 | `rate_limit_error` | `daily_token_limit` |
| 每日请求次数超限 | 429 | `rate_limit_error` | `daily_request_limit` |
| 每分钟请求超限 | 429 | `rate_limit_error` | `rate_limit_exceeded` |
| 不在允许时间段内 | 403 | `permission_error` | `time_restricted` |
| 后端不可用 | 502 | `server_error` | `backend_unavailable` |
| 后端超时 | 504 | `server_error` | `backend_timeout` |

### 4.2 管理后台 API（`/api/admin/*`）

所有请求通过 JWT cookie 认证，仅 `is_admin=true` 的用户可访问。

#### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/admin/auth/login` | 登录（email + password → JWT cookie） |
| `POST` | `/api/admin/auth/logout` | 登出（清除 cookie） |
| `GET` | `/api/admin/auth/me` | 获取当前管理员信息 |

#### 用户管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/users` | 用户列表（支持分页、搜索） |
| `POST` | `/api/admin/users` | 创建用户（自动生成 api_key） |
| `GET` | `/api/admin/users/{id}` | 用户详情 |
| `PUT` | `/api/admin/users/{id}` | 更新用户信息 |
| `DELETE` | `/api/admin/users/{id}` | 删除用户 |
| `POST` | `/api/admin/users/{id}/regenerate-key` | 重新生成 API Key |

#### 模型管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/models` | 模型列表 |
| `POST` | `/api/admin/models` | 注册模型 |
| `GET` | `/api/admin/models/{id}` | 模型详情 |
| `PUT` | `/api/admin/models/{id}` | 更新模型 |
| `DELETE` | `/api/admin/models/{id}` | 删除模型 |
| `POST` | `/api/admin/models/{id}/test` | 测试后端连通性 |

#### 用户-模型授权与限额

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/users/{id}/models` | 获取用户已授权的模型及限额 |
| `POST` | `/api/admin/users/{id}/models` | 为用户授权模型（自动继承默认限额模板） |
| `DELETE` | `/api/admin/users/{id}/models/{modelId}` | 取消授权 |
| `PUT` | `/api/admin/users/{id}/models/{modelId}/quota` | 设置/更新用户对该模型的限额 |

#### 用量统计

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/usage/overview` | 总览统计（今日/近7天/近30天） |
| `GET` | `/api/admin/usage/by-user` | 按用户统计 |
| `GET` | `/api/admin/usage/by-model` | 按模型统计 |
| `GET` | `/api/admin/usage/by-user/{id}` | 单个用户的详细用量 |
| `GET` | `/api/admin/usage/logs` | 请求日志列表（分页） |

---

## 五、请求代理核心流程

### 5.1 完整请求生命周期

```
请求到达 /api/v1/chat/completions 或 /api/v1/completions
│
├─ 1. 解析 Authorization Header
│     提取 Bearer token → api_key
│     失败 → 401 invalid_api_key
│
├─ 2. 用户认证
│     SELECT * FROM users WHERE api_key = $1
│     未找到 → 401 invalid_api_key
│     is_active = false → 403 user_disabled
│
├─ 3. 模型解析
│     从 request body 提取 model 字段
│     SELECT * FROM models WHERE alias = $1 AND is_active = true
│     未找到 → 404 model_not_found
│
├─ 4. 权限检查
│     SELECT 1 FROM user_models WHERE user_id = $1 AND model_id = $2
│     未找到 → 403 model_not_allowed
│
├─ 5. 限额检查（按顺序）
│     a. 时间窗口检查
│        获取限额配置（优先 user_model_quotas，fallback models.default_*）
│        当前时间不在 [allowed_time_start, allowed_time_end] 内
│        → 403 time_restricted
│
│     b. 每分钟请求限流（内存滑动窗口）
│        检查最近 60s 内该 user+model 的请求数
│        超过 max_requests_per_min → 429 rate_limit_exceeded
│
│     c. 每日请求次数
│        SELECT request_count FROM daily_usage
│          WHERE user_id=$1 AND model_id=$2 AND date=today
│        超过 max_requests_per_day → 429 daily_request_limit
│
│     d. 每日 token 用量
│        SELECT total_tokens FROM daily_usage
│          WHERE user_id=$1 AND model_id=$2 AND date=today
│        超过 max_tokens_per_day → 429 daily_token_limit
│
├─ 6. 构造后端请求
│     - URL: backend_url + /chat/completions 或 /completions
│     - Headers: Authorization: Bearer <backend_api_key>
│     - Body: 替换 model 字段为 backend_model，其余原样透传
│       （包括 messages, stream, tools, tool_choice,
│         temperature, max_tokens 等所有参数）
│
├─ 7. 发送请求到后端并处理响应
│     ├─ 后端无响应 → 502 backend_unavailable
│     ├─ 后端超时 → 504 backend_timeout
│     ├─ 非流式响应:
│     │    等待完整 JSON → 提取 usage 字段 → 返回给用户
│     └─ 流式响应 (SSE):
│          使用 TransformStream 逐 chunk 透传
│          解析最后一个包含 usage 的 chunk
│          （若后端未返回 usage，则 tokens 记为 0）
│
└─ 8. 异步记录用量（不阻塞响应）
      - INSERT INTO usage_logs (...)
      - INSERT INTO daily_usage (...) ON CONFLICT (user_id, model_id, date)
        DO UPDATE SET
          total_tokens = daily_usage.total_tokens + $tokens,
          request_count = daily_usage.request_count + 1
```

### 5.2 SSE 流式透传实现要点

```typescript
// 核心伪代码
async function handleStreamResponse(
  backendResponse: Response,
  userId: string,
  modelId: string
): Promise<Response> {
  let usageData = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      // 原样透传每个 SSE chunk 给客户端
      controller.enqueue(chunk);

      // 尝试从 chunk 中解析 usage（通常在最后一个 chunk）
      // vLLM 在 stream_options.include_usage=true 时会在最后返回 usage
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const jsonStr = line.slice(6); // 去掉 "data: "
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.usage) {
            usageData = parsed.usage;
          }
        } catch { /* 忽略解析失败 */ }
      }
    },
    flush() {
      // 流结束后异步记录用量
      recordUsage(userId, modelId, usageData).catch(console.error);
    }
  });

  backendResponse.body!.pipeThrough(transformStream);

  return new Response(transformStream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 5.3 内存限流器

```typescript
// 基于滑动窗口的简单限流，standalone 单进程下可靠
class RateLimiter {
  // key: "userId:modelId", value: 请求时间戳数组
  private windows: Map<string, number[]> = new Map();

  check(userId: string, modelId: string, maxPerMin: number): boolean {
    const key = `${userId}:${modelId}`;
    const now = Date.now();
    const windowStart = now - 60_000;

    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter(t => t > windowStart); // 清理过期

    if (timestamps.length >= maxPerMin) return false;

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }

  // 定时清理（每 5 分钟清一次长期不活跃的 key）
  cleanup() { /* ... */ }
}

// 全局单例
export const rateLimiter = new RateLimiter();
```

### 5.4 超时配置

| 场景 | 超时时间 |
|------|---------|
| 非流式请求 | 300 秒 |
| 流式请求 | 600 秒 |
| 后端连通性测试 | 10 秒 |

通过环境变量可配置：
```
PROXY_TIMEOUT_NON_STREAM=300000
PROXY_TIMEOUT_STREAM=600000
```

---

## 六、Admin Console 页面设计

### 6.1 页面结构

```
/admin/login                    ← 登录页
/admin                          ← 重定向到 /admin/dashboard
/admin/dashboard                ← 总览仪表盘
/admin/users                    ← 用户列表
/admin/users/new                ← 创建用户
/admin/users/{id}               ← 用户详情（含授权模型 + 限额配置）
/admin/models                   ← 模型列表
/admin/models/new               ← 注册模型（含默认限额模板）
/admin/models/{id}              ← 模型详情/编辑
/admin/usage                    ← 用量统计
```

### 6.2 各页面功能详述

#### Dashboard（`/admin/dashboard`）

```
┌──────────────────────────────────────────────────┐
│  Dashboard                                        │
│                                                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────┐ │
│  │ 总用户数  │ │ 活跃模型 │ │ 今日请求 │ │今日   │ │
│  │   12     │ │    8     │ │  3,456   │ │Token  │ │
│  │          │ │          │ │          │ │1.2M   │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────┘ │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  近 7 天请求量趋势（折线图）                    │  │
│  │  📈                                          │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │  近 7 天 Token 消耗趋势（折线图）              │  │
│  │  📈                                          │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

#### 用户管理（`/admin/users`）

- **列表页**：表格展示（名称、邮箱、API Key、状态、已授权模型数、今日用量、操作）
- **创建用户**：填写名称、邮箱 → 自动生成 API Key → 创建后展示完整 Key
- **用户详情页**：
  - 基本信息编辑（名称、邮箱、启用/禁用）
  - API Key 展示 + 重新生成按钮
  - 已授权模型列表 + 每个模型的限额配置（内联编辑）
  - 添加模型授权（下拉选择，自动继承模型默认限额）
  - 该用户的用量统计摘要

#### 模型管理（`/admin/models`）

- **列表页**：表格展示（别名、后端地址、后端模型名、状态、授权用户数、操作）
- **注册模型**：
  - 填写：别名（限制 `a-z0-9-`）、后端 URL、后端模型名、后端 API Key
  - 设置默认限额模板（可选）
  - 「测试连接」按钮
- **模型详情页**：编辑模型信息 + 默认限额模板

#### 用量统计（`/admin/usage`）

- 日期范围选择器
- **按用户统计 Tab**：表格（用户名、总请求数、总 Token、按模型明细展开）
- **按模型统计 Tab**：表格（模型别名、总请求数、总 Token、按用户明细展开）
- **请求日志 Tab**：分页表格（时间、用户、模型、类型、Token 数、耗时、状态）

---

## 七、环境变量

```bash
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/llm_gateway

# 初始管理员（首次启动时 seed）
ADMIN_NAME=Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# JWT
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=24h

# 时区（用于时间窗口限额检查）
TZ=Asia/Shanghai

# 代理超时（毫秒）
PROXY_TIMEOUT_NON_STREAM=300000
PROXY_TIMEOUT_STREAM=600000
```

---

## 八、项目目录结构

```
llm-gateway/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── chat/
│   │   │   │   │   └── completions/
│   │   │   │   │       └── route.ts          # POST: Chat Completions 代理
│   │   │   │   ├── completions/
│   │   │   │   │   └── route.ts              # POST: Completions 代理
│   │   │   │   └── models/
│   │   │   │       ├── route.ts              # GET: 模型列表
│   │   │   │       └── [model]/
│   │   │   │           └── route.ts          # GET: 单个模型详情
│   │   │   ├── admin/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── login/route.ts
│   │   │   │   │   ├── logout/route.ts
│   │   │   │   │   └── me/route.ts
│   │   │   │   ├── users/
│   │   │   │   │   ├── route.ts              # GET: 列表, POST: 创建
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── route.ts          # GET, PUT, DELETE
│   │   │   │   │       ├── regenerate-key/route.ts
│   │   │   │   │       └── models/
│   │   │   │   │           ├── route.ts      # GET: 用户模型列表, POST: 授权
│   │   │   │   │           └── [modelId]/
│   │   │   │   │               ├── route.ts  # DELETE: 取消授权
│   │   │   │   │               └── quota/route.ts  # PUT: 设置限额
│   │   │   │   ├── models/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [id]/
│   │   │   │   │       ├── route.ts
│   │   │   │   │       └── test/route.ts     # POST: 测试连通性
│   │   │   │   └── usage/
│   │   │   │       ├── overview/route.ts
│   │   │   │       ├── by-user/
│   │   │   │       │   ├── route.ts
│   │   │   │       │   └── [id]/route.ts
│   │   │   │       ├── by-model/route.ts
│   │   │   │       └── logs/route.ts
│   │   │   └── health/
│   │   │       └── route.ts                  # 健康检查
│   │   ├── admin/
│   │   │   ├── layout.tsx                    # Admin 布局（侧边栏 + JWT 检查）
│   │   │   ├── login/page.tsx
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── users/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── models/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   └── usage/page.tsx
│   │   ├── layout.tsx
│   │   └── page.tsx                          # 根页面，重定向到 /admin
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts                      # Drizzle 连接
│   │   │   ├── schema.ts                     # Drizzle schema 定义
│   │   │   └── seed.ts                       # 初始管理员 seed
│   │   ├── auth/
│   │   │   └── jwt.ts                        # JWT 签发/验证
│   │   ├── proxy/
│   │   │   ├── handler.ts                    # 请求代理核心逻辑
│   │   │   ├── stream.ts                     # SSE 流式透传
│   │   │   └── errors.ts                     # OpenAI 格式错误构造
│   │   ├── quota/
│   │   │   ├── checker.ts                    # 限额检查逻辑
│   │   │   └── rate-limiter.ts               # 内存滑动窗口限流
│   │   ├── usage/
│   │   │   └── recorder.ts                   # 用量记录（usage_logs + daily_usage）
│   │   └── utils/
│   │       ├── api-key.ts                    # API Key 生成
│   │       └── validators.ts                 # 输入校验（模型别名格式等）
│   ├── middleware.ts                         # Next.js 中间件（admin 路由 JWT 检查）
│   └── components/                           # shadcn/ui 组件
│       └── ...
├── drizzle/
│   └── migrations/                           # 数据库迁移文件
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 九、关键实现备注

### 9.1 `GET /api/v1/models` 响应格式

严格遵循 OpenAI API 格式：

```json
{
  "object": "list",
  "data": [
    {
      "id": "my-qwen3",
      "object": "model",
      "created": 1700000000,
      "owned_by": "llm-gateway"
    },
    {
      "id": "my-qwen3.5",
      "object": "model",
      "created": 1700000000,
      "owned_by": "llm-gateway"
    }
  ]
}
```

### 9.2 模型别名校验规则

```
/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
```

- 只允许小写字母、数字、短横线
- 不能以短横线开头或结尾
- 长度 1-100

### 9.3 API Key 格式

```
sk-<32位随机十六进制字符>
```

示例：`sk-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`

### 9.4 健康检查响应

```json
// GET /api/health
{
  "status": "ok",
  "timestamp": "2026-03-17T10:30:00.000Z",
  "database": "connected"
}
```

### 9.5 模型连通性测试

`POST /api/admin/models/{id}/test` 向后端发送 `GET <backend_url>/models`，10 秒超时：

```json
// 成功
{ "status": "ok", "latency_ms": 42 }

// 失败
{ "status": "error", "message": "Connection refused" }
```

---
