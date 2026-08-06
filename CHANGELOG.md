# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.2] - 2026-08-06

### 🐛 Bug Fixes

- **Model edit page rendered a blank form instead of an error** — the loader on `/admin/models/<id>` never checked `res.ok`, so an error response was parsed as if it were a model. Every field then read as `undefined`, and the backend list fell through to its "no backends yet" fallback, producing an empty backend row. The page therefore looked like a model whose backend URL, served model name and API key had all been lost, when in fact the request had failed — most visibly after upgrading to 0.4.x with the code deployed before `npm run migrate` had been run, since the missing `model_backends` table makes the endpoint return 500. The loader now rejects non-OK responses and the page reports the failure (including the server's message) instead of showing an editable blank form. The sibling user and group detail pages already guarded this and are unchanged.

## [0.4.1] - 2026-08-06

### 🐛 Bug Fixes

- **Deleting a user no longer fails** — `usage_logs.user_id` and `daily_usage.user_id` referenced `users(id)` with `ON DELETE NO ACTION`, so deleting any user who had ever made a request raised a foreign-key violation. Because the handler did not catch it, the failure surfaced as a bare 500 with no error body and the admin console showed an empty error toast — deletion appeared to do nothing at all. Users with no usage history deleted fine, which made the failure look intermittent. Both constraints are now `ON DELETE SET NULL`: the account is removed while its usage rows survive anonymised, so historical totals on the dashboard stay accurate. The endpoint also translates any remaining foreign-key violation into a readable `409` instead of a 500, and the console falls back to a generic message when an error response is not JSON.
- **`users.group_id` schema drift** — the initial groups migration appended `SET NOT NULL` by hand after its generated section, so Drizzle never recorded it: every snapshot since declared the column nullable and no corrective migration was ever generated. Meanwhile the application treats a missing group as valid throughout — the proxy falls back to per-user quotas, the admin update endpoint has an explicit `groupId: null` branch, and the user list renders `—`. Sending `groupId: null` to the update endpoint, or creating a user while no default group exists, therefore failed with an opaque 500. The database is now aligned with the declared schema, making those paths reachable as intended.
- **Model alias validation was silently disabled** — the alias field's HTML `pattern` attribute used an unescaped `-` and `/` inside a character class. Browsers compile that attribute with the RegExp `v` flag, which rejects both, and per the HTML specification a pattern that fails to compile is ignored entirely — so the field accepted any input client-side and logged a `SyntaxError` to the console on every render of the model form. The pattern was also stricter than the server's, rejecting valid aliases such as `openai/gpt-4o`. The form now derives its pattern from the shared `MODEL_ALIAS_PATTERN`, so client and server validation can no longer drift, and the alias hint text now lists the separators that are actually accepted.

## [0.4.0] - 2026-08-05

### Added: Multi-Backend Load Balancing

- **One model alias → many upstream backends** — a model is now a public alias plus a list of backends (`model_backends` table), so the same model deployed on several vLLM servers no longer needs `-1`/`-2` alias suffixes. Existing models are migrated automatically (each becomes a single-backend model); previously suffixed aliases can be merged by adding their backends to one model in the admin console and deleting the rest. Quotas, authorizations, and usage statistics stay keyed on the model and aggregate across its backends unchanged.
- **Cache-affinity routing with failover** — chat/completions requests are routed by hashing the conversation's stable head (system prompt + first user message) with rendezvous (HRW) hashing, so every turn of a conversation lands on the same backend and hits vLLM's prefix cache; different conversations spread evenly. Embeddings/rerank requests round-robin. When a backend is unreachable or returns 5xx/429, the request automatically fails over to the next backend (streamed requests included, up until streaming has started); non-429 4xx responses return immediately. A model with no active backends returns `503 backend_unavailable`. The Anthropic-compatible endpoint uses the same routing. The affinity hash-length guard is tunable via `AFFINITY_PREFIX_LENGTH` (default 16384).
- **Admin multi-backend management** — the model form manages a list of backends (URL / served model name / API key / active toggle, per backend), the model list shows a backend count summary, and the **Test** button now probes every backend of a model (or a single one via `{ backendId }`), returning per-backend results. The admin API accepts a nested `backends` array on create/update while still accepting the legacy flat `backendUrl`/`backendModel`/`backendApiKey` fields as a single-backend shorthand. Audit-log redaction now recurses into nested payloads so per-backend API keys stay redacted.
- **Context window across backends** — `GET /api/v1/models` (and the single-model variant) now reports `max_model_len` as the minimum advertised window across a model's active backends, the safe value whichever backend serves the request.

### Added: Rerank Models

- **OpenAI-compatible `/api/v1/rerank` endpoint** — the gateway now proxies rerank requests (`{ query, documents }`) through the same authentication, authorization, quota, rate-limiting, and usage-accounting pipeline as chat and embeddings. Requests are forwarded to `{backendUrl}/rerank`, so any Jina / vLLM / Xinference / TEI / Cohere-compatible rerank backend works by configuring the model's backend URL. Rerank is always non-streaming; usage records the upstream `prompt_tokens`/`total_tokens` when returned (`completion_tokens = 0`). No schema migration was needed.
- **`rerank` model type** — models can now be typed `rerank` (alongside `chat` and `embedding`) when registering or editing a model in the admin console, and the admin **Test** button probes the real `/rerank` endpoint with a minimal payload. The gateway enforces that `/api/v1/rerank` is used only with `rerank` models, returning `404 model_type_mismatch` otherwise. The type is also surfaced in `GET /api/v1/models`.

## [0.3.0] - 2026-07-13

### Added: Embedding Models

- **OpenAI-compatible `/api/v1/embeddings` endpoint** — the gateway now proxies embedding requests through the same authentication, authorization, quota, rate-limiting, and usage-accounting pipeline as chat/completions. Embedding usage records prompt tokens only (`completion_tokens = 0`); no schema migration was needed for usage logging.
- **Model `type` field** — each model is now typed `chat` (default) or `embedding`, set when registering or editing a model in the admin console. The gateway enforces that `/api/v1/embeddings` is used only with `embedding` models and the chat/completions endpoints only with `chat` models, returning `404 model_type_mismatch` otherwise. The type is also surfaced in `GET /api/v1/models`.

## [0.2.0] - 2026-07-01

### Added: Admin Audit Log

- **Append-only audit trail** — every state-changing admin action (create/update/delete of users, groups, models, quotas, and model-access grants) plus security events (admin login, failed login, logout, and "View as User" impersonation) is now recorded to a dedicated `audit_logs` table. Records are written asynchronously, so auditing never slows down or breaks the original action.
- **Rich, safe records** — each entry captures the acting admin, the action, the target (with a snapshot label that stays readable even after the referenced entity is deleted), a field-level before→after diff, client IP, user agent, and success/failure. Secrets (password hashes, API keys, backend keys) are always redacted, enforced centrally at the write layer so they can never reach the audit log.
- **Audit dashboard** — a new read-only **Audit Log** page in the admin sidebar lets admins filter by admin, action, resource type, status, date range, and free-text search, inspect the before→after diff of any event, and export the filtered results to CSV.

## [0.1.3] - 2026-04-27

### 🐛 Bug Fixes

- **View as User flow** — fixed the admin "View as User" entry so it reliably lands on the real dashboard URL even behind a reverse proxy. The handoff now uses a temporary URL token that middleware converts into the user session cookie before redirecting to a clean `/dashboard` URL, avoiding broken links and unreliable cookie-setting on redirects.
- **Admin user navigation** — returning from `/admin/users/[id]` now preserves the current list page and search keywords. The edit page receives the original list URL through a `back` query parameter, so the back button returns admins to the exact filtered context they came from instead of resetting to the first page.

## [0.1.2] - 2026-04-25

### 🐛 Bug Fixes

- **Admin groups page** — the user select dropdown was being clipped by its parent card's `overflow-hidden`, making it appear as a tiny sliver with an unusable search box. Removed `overflow-hidden` from the `SectionCard` wrapper to fix the root cause.
- **SearchableSelect** — option labels now truncate with an ellipsis instead of wrapping; dropdown has a minimum width of 280 px to comfortably display `"Name (email)"` entries. Added an optional `searchText` field so callers can provide a plain `"name email"` string for matching independently of the display label.

---

## [0.1.1] - 2026-04-25

### Infrastructure

- Added automated versioning and bilingual changelog generation (`npm run release` / `npm run changelog`)
- Added commitlint + husky to enforce Conventional Commits format on every commit

---

## [0.1.0] - 2026-04-25

Initial release. Includes the full proxy gateway core, admin dashboard, group-based access control, user self-service portal, and i18n support.

### Added: Group-Based Access Control

A complete multi-tenant group system for managing model access and quotas:

- New Groups system — members inherit the group's model access permissions and usage quotas automatically
- Admins can add/remove members from a group's detail page; deleting a group moves members to the Default group
- The Default group acts as a fallback; its quota settings do not restrict members (individual quotas take precedence)
- Full CRUD API for group management in the admin dashboard

### Added: User Self-Service Portal

- New user login page (`/login`) and registration page with admin approval workflow
- New user dashboard (`/dashboard`) showing usage trends, remaining quota, API key (with one-click copy), and Python/curl code examples
- Dashboard includes a pie chart of per-model token consumption for the last 7 days

### Added: Chinese / English Internationalization

- Full i18n support across both the admin dashboard and user portal
- Language switcher available in the sidebar and top navigation
- Language priority: saved localStorage preference → browser language → English fallback

### Improved: Admin Dashboard

- Usage dashboard now supports time range selection (7 / 14 / 30 days)
- User list supports pagination with search and page state persisted in the URL
- New "View as User" feature — admins can preview a user's dashboard without their password
- Usage logs support one-click navigation from the user list with auto-applied filter
- New `SearchableSelect` component for user/model pickers throughout the admin UI
- Request prompt is now shown in full in the usage log modal (no longer truncated)

### Fixed

- SSR/CSR hydration mismatch caused by localStorage-based language detection
- Non-admin users were unable to update their own password
- Upstream proxy error messages were overly technical and confusing; now normalized to user-friendly text
- Clipboard copy failed in environments without `navigator.clipboard` (e.g., HTTP); added fallback
- SQL array query crash when fetching the admin user list under certain conditions
- Admin seed was not triggered on the first admin login request
- Recharts tooltip formatter type errors in the dashboard charts

### Documentation

- Added a Chinese system architecture design document
- README (both English and Chinese) now includes detailed setup, database configuration, and production deployment guides
- Documents the `npm run migrate` workflow for production deployments

### Infrastructure

- Added database query performance indexes (`idx_daily_usage_date`, `idx_usage_logs_created_at`)
- Usage overview API now uses a 5-minute in-memory TTL cache to reduce redundant DB queries
- New `npm run migrate` script wrapping drizzle-kit migrator for production deployments
