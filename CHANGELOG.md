# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
