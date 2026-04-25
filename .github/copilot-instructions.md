# Copilot Instructions

## Commands

```bash
npm run dev          # start dev server (http://localhost:3000)
npm run build        # production build
npm run lint         # ESLint
npm run test         # Vitest unit/API tests (no DB required)
npm run test:watch   # Vitest in watch mode
npm run test:e2e:real  # E2E against a live gateway (requires running server + DB)
npm run test:perf:smoke  # k6 smoke test
```

Run a single test file:
```bash
npx vitest run src/lib/proxy/errors.test.ts
```

Run tests matching a name pattern:
```bash
npx vitest run --reporter verbose -t "normalizeBackendError"
```

Database migrations:
```bash
npx drizzle-kit generate   # generate migration files from schema changes
npx drizzle-kit migrate    # apply migrations to the database
```

## Architecture

This is a Next.js 16 App Router application that acts as an OpenAI-compatible proxy gateway.

### Request Pipeline (`POST /api/v1/chat/completions`)

All traffic flows through `src/lib/proxy/handler.ts` → `handleProxy()`:

1. **Authenticate** — extract `Bearer <api_key>` from `Authorization` header, look up user in DB
2. **Parse** — decode JSON body, extract `model` alias and last user message for prompt preview
3. **Resolve model** — look up model by `alias` in DB (alias is client-visible; `backendModel` is the upstream name)
4. **Authorize** — check `user_models` join table to confirm user has access
5. **Quota check** (`src/lib/quota/checker.ts`) — time window → per-minute rate limit (in-memory) → daily token/request limits (DB)
6. **Forward** — rewrite `model` field to `backendModel`, send to `backendUrl`, handle streaming via `TransformStream`
7. **Record usage** — non-blocking via `setImmediate` in `src/lib/usage/recorder.ts`

### Auth Separation

Two independent auth flows:
- **Admin**: `admin_token` cookie + `isAdmin: true` in JWT payload → guards `/admin/*` and `/api/admin/*`
- **User**: `user_token` cookie → guards `/dashboard/*`
- **API clients**: `Authorization: Bearer <api_key>` header → guards `/api/v1/*`

Middleware (`src/middleware.ts`) only protects page routes. API admin routes must call `getAdminUser()` from `src/app/api/admin/middleware.ts` themselves.

### Database

6 tables defined in `src/lib/db/schema.ts`:
- `users` — includes `api_key`, `is_active`, `is_admin`
- `models` — `alias` (client name) + `backendUrl`/`backendModel`/`backendApiKey` + default quota fields
- `user_models` — many-to-many join granting access
- `user_model_quotas` — per-user per-model quota overrides (null = use model default; model default null = unlimited)
- `usage_logs` — per-request log
- `daily_usage` — aggregated daily counters, upserted atomically

DB connection pool and rate limiter are stored as `global._pgPool` and `global._rateLimiter` to survive HMR reloads.

### Admin Seeding

The initial admin user is seeded lazily on the first request to `POST /api/admin/auth/login` or `POST /api/v1/chat/completions`, only if `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` are all set and no admin exists yet.

## Key Conventions

### Path alias
`@` resolves to `src/`. Configured in both `tsconfig.json` and `vitest.config.ts`.

### Error responses
All proxy errors use `makeProxyError(message, type, code, status)` from `src/lib/proxy/errors.ts`, which always returns `{ error: { message, type, code } }` JSON. Admin API routes use the helpers in `src/app/api/admin/middleware.ts` (`unauthorizedResponse()`, `forbiddenResponse()`, `notFoundResponse()`, `badRequestResponse()`).

### Quota override hierarchy
`userModelQuotas` row overrides model defaults. Any quota field being `null` means no limit. The effective value is: `quota?.field ?? model.defaultField ?? null`.

### Unit test mocking
Tests use `vi.hoisted()` to create mock functions before module imports, then pass them into `vi.mock()` factory functions. This is required because `vi.mock()` is hoisted by Vitest but the mock implementations need to be defined before the module under test is imported.

```ts
const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mockSelect } }));
```

Unit tests do not require a running database — all DB calls are mocked.

### Streaming
The proxy uses a `TransformStream` (`src/lib/proxy/stream.ts`) to pass SSE chunks through while parsing usage from the final chunk. Usage is recorded via the `onComplete` callback in `flush()`.

## Changelog & Release Workflow

When the user asks to write a changelog or cut a release:

1. **Determine the version** — run `git describe --tags --abbrev=0` to get the last tag, then use `conventional-recommended-bump` (or inspect commits manually) to suggest the next SemVer version. **Always confirm the proposed version with the user before proceeding.**

2. **Collect commits** — run `git log <last-tag>..HEAD --format="%H|%s|%b"` (or use the existing `scripts/generate-changelog-zh.mjs --stdout` for a quick list).

3. **Write both changelogs directly** — do not call any external API or translation service. As an AI, write the content yourself:
   - **`CHANGELOG.md`** (English) — grouped by feature area, natural prose, Keep a Changelog format
   - **`CHANGELOG-zh.md`** (Chinese) — same structure, written in fluent Chinese technical style; do not mechanically translate, write it as a native speaker would

4. **Apply the files** — edit `CHANGELOG.md` and `CHANGELOG-zh.md` directly, prepending the new version section.

5. **Commit** — run `npm run release -- --changelog-only` if only updating changelogs, or bump `package.json` version, commit, and tag if doing a full release.

**Quality bar**: Group related commits into themes (not per-commit bullet lists). Use emoji section headers (✨ / 🐛 / ⚡ / 📝 / 🔧). Write for a reader who wants to know *what changed and why*, not just the raw commit messages.

## Test-First for Changes

Before refactoring existing code or implementing a new feature, add or update test cases first. This ensures regressions are caught and the intended behavior is clearly defined before code changes begin.

## Git Commit Messages

After completing a task, commit the changes once the code is working and all relevant tests pass — unless the user explicitly asks not to commit.

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <short summary>

[optional body — explain *what* and *why*, not *how*]

[optional footer(s)]
```

**Types**: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `docs`, `chore`, `ci`, `build`

**Rules**:
- Subject line: imperative mood, no period, ≤ 72 chars
- Scope: the module/layer being changed (optional but encouraged)
- Body: wrap at 72 chars; use bullet points for multiple changes
- Breaking changes: add `BREAKING CHANGE:` footer or append `!` after type
