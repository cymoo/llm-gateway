# LLM Gateway

An LLM gateway built with **Next.js 16**, **Drizzle ORM**, and **PostgreSQL**.

## Language Versions

- English: `README.md` (this file)
- 中文: `README-zh.md`

## Features

- Unified OpenAI-compatible `chat.completions` proxy endpoint
- Public self-registration (`/register`) with admin approval workflow
- User and model access management
- Quota and rate limiting per user/model
- Usage analytics (logs and daily statistics)
- Admin console for managing users and models

## Tech Stack

- **Framework**: Next.js `16.1.7` (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM + Drizzle Kit
- **Auth**: JWT (`jose`) + Cookie
- **Password Hashing**: `bcryptjs`
- **UI**: React 19 + Tailwind CSS 4 + Radix UI

## Project Structure

```text
src/
├─ app/
│  ├─ api/                    # API routes (including /api/v1/chat/completions)
│  └─ admin/                  # Admin pages
├─ lib/
│  ├─ auth/                   # JWT issue/verify
│  ├─ db/                     # Drizzle schema, connection, seed
│  ├─ proxy/                  # Upstream LLM forwarding
│  ├─ quota/                  # Quota and rate limit logic
│  └─ usage/                  # Usage logging
└─ middleware.ts
```

## Quick Start

### 1) Install dependencies

```bash
npm ci
```

### 2) Configure environment variables (`.env`)

```env
# PostgreSQL connection (required)
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/llm_gateway

# Default admin (optional but recommended)
ADMIN_EMAIL=admin@example.com
ADMIN_NAME=System Admin
ADMIN_PASSWORD=ChangeMe123!

# JWT secret (strongly recommended in production)
JWT_SECRET=replace-with-a-long-random-secret

# Optional proxy timeout (ms)
PROXY_TIMEOUT_NON_STREAM=300000
PROXY_TIMEOUT_STREAM=600000
```

### 3) Initialize database

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

If your PostgreSQL does not enable `pgcrypto`, run:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 4) Start development server

```bash
npm run dev
```

Default URL: `http://localhost:3000`

## Admin Seed Behavior

The initial admin is not created on startup. It is lazily seeded when the first request hits either:

- `POST /api/admin/auth/login`
- `POST /api/v1/chat/completions`

Seed is attempted only when all three variables are set:

- `ADMIN_EMAIL`
- `ADMIN_NAME`
- `ADMIN_PASSWORD`

If an admin user already exists (`is_admin=true`), no duplicate admin will be created.

## Self-registration and Approval

- Users can submit account requests on `GET /register` (API: `POST /api/auth/register`).
- Newly registered users are created as inactive and cannot use API endpoints yet.
- Admins can review users in `/admin/users` and click **Approve**.
- Approval calls `POST /api/admin/users/:id/approve`, which activates the account.

## Scripts

```bash
npm run dev
npm run lint
npm run test
npm run build
npm run start
```

## Testing

This project now includes API route tests using Vitest.

Run unit / API tests:

```bash
npm run test
```

### End-to-End Tests (Real Requests)

The e2e suite sends real HTTP requests to a running gateway and verifies forwarding
correctness and protocol compatibility. It requires a running gateway and a reachable
PostgreSQL database with at least one active user and model.

1. **Start the gateway** (in a separate terminal):

   ```bash
   npm run dev
   ```

2. **Configure `.env.test`** — make sure the following variables are set:

   ```env
   # Gateway URL the tests will hit
   TEST_BASE_URL=http://localhost:3000

   # PostgreSQL connection for test queries
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/llm_gateway

   # Optional: narrow down test user / model
   TEST_USER_ID=
   TEST_USER_EMAIL=
   TEST_MODEL_PROVIDER=
   TEST_MODEL_NAME=

   # Per-request timeout in milliseconds (default: 60000)
   TEST_HTTP_TIMEOUT_MS=60000
   ```

   You can also use `TEST_DATABASE_URL` instead of `DATABASE_URL` if you want to
   keep the e2e database separate.

3. **Run the e2e tests**:

   ```bash
   npm run test:e2e:real
   ```

### Performance Smoke Test (k6)

```bash
npm run test:perf:smoke
```
