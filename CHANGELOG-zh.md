# 更新日志

所有值得关注的更改都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.1.0] - 2026-04-25

### ✨ 新功能

- admin dashboard time range, perf indexes, users pagination, user model pie chart (`32ff991`)
- **i18n**: add Chinese language support with sidebar language switcher (`449b944`)
- **i18n**: migrate all admin and dashboard pages to use t() translations (`fbb9ba7`)
- **ui**: add SearchableSelect component and extend users API with group info (`9108871`)
- **users**: add view-as-user button to admin users list (`94d833d`)
- **ui**: add Default group quota notice and replace Approve with Dashboard link (`6ad9211`)
- **ui**: use SearchableSelect for user pickers in groups detail and usage pages (`3026018`)
- **groups**: add members management to group detail page (`05c2c78`)
- **groups**: improve groups page and add migration docs (`699e222`)
- **groups**: add user group-based access control and quota management (`d5d3673`)
- add password to register, use ADMIN_NAME in success msg, add HOST to no_proxy (`ac3bc2e`)
- add user login page and dashboard with usage stats, quota info, API access, and Python examples (`b55fc93`)
- add admin model-user modal and usage filter enhancements (`a317d9b`)
- add remark field to users and models admin flows (`fbcd42e`)
- add self-registration with admin approval flow (`1034c89`)
- add csv export for usage request logs (`7ea40c1`)
- add admin password validation, api key copy, alias relax and api tests (`9243acd`)

### 🐛 问题修复

- **i18n**: prevent hydration mismatch from localStorage language detection (`8221e97`)
- **ui**: link users list to usage logs page pre-filtered by user (`6875b45`)
- allow password update for non-admin users (`48873dc`)
- address code review feedback - use inArray, improve protocol detection (`4ac9a21`)
- address review feedback for admin stats and filters (`140b64c`)
- **admin**: show full request prompt in modal and stop truncating stored prompt (`1448ce4`)
- handle non-string error.code in normalizeBackendError and load .env.test for e2e tests (`2703215`)
- normalize confusing upstream proxy error messages (`f6295c8`)
- ensure clipboard copy works across environments with fallback method (`c7a86be`)
- handle admin users fetch safely and avoid SQL array query crash (`7a5b764`)
- seed admin on first admin login request (`1f782ae`)
- resolve usage tooltip typing and split readmes by language (`2024cfa`)
- adjust dashboard tooltip formatters for Recharts ValueType (`393581e`)
- resolve dashboard tooltip formatter type errors (`23fb7bc`)

### ♻️ 代码重构

- simplify login seed trigger without process flag (`25cbb90`)

### 📝 文档更新

- clarify password settings copy (`10a5871`)
- add high-level system design documentation (`74f50c2`)
- rewrite README with detailed project and database setup guide (`dcb003c`)

### ✅ 测试

- cover upstream rate-limit error normalization (`3548944`)

### 🔧 杂项

- **husky**: add pre-commit test hook (`c2b7f9b`)
- add versioning and changelog tooling (`055572c`)
- **db**: add npm run migrate script for deployment (`f8b958a`)
- add copilot instruction (`93bc8e1`)
- address review feedback and finalize validation (`987c70f`)
- clean up redundant test-related notes (`071d9fb`)
- address review feedback for validation reuse and clipboard fallback (`df87af5`)

