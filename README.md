# Iran War Radar API / بک‌اند رادار جنگ ایران

A **Node.js/TypeScript API companion for an Android news-reader/radar application**. This repository contains the backend only, not the Android app or a standalone news-dashboard website. Its root route is a small API status/diagnostic page.

The source includes Express routes, SQLite persistence, source management, synthetic demonstration records, grouping/deduplication logic and optional RSS, Guardian, Telegram and Gemini connectors. It does not establish the accuracy of news reports, live connector availability, or operational readiness.

## Local demo

Requirements: **Node.js 22.13+** and npm. SQLite uses Node's built-in `node:sqlite`; some Node versions still print an experimental-API warning.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run build
```

Copy `.env.example` to `.env`, then start the local API:

```powershell
Copy-Item .env.example .env
npm start
```

On macOS/Linux, use `cp .env.example .env`. Open [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health) or the diagnostic page at [http://127.0.0.1:8787](http://127.0.0.1:8787).

First startup creates a local SQLite database and synthetic records labeled as demo data. Existing databases, scraped articles, logs, sessions and account credentials are not shipped. The placeholder Telegram channel `@example_public_channel` is illustrative and is not a configured owner account.

**Background collection and Telegram polling are off by default in this portfolio copy.** The supplied example credentials are local-demo placeholders. No real provider key is required to inspect demo routes. `ADMIN_PASSWORD=change-me` is deliberately public and must not be used for a deployed service; production validation rejects the shipped placeholders.

## API surface

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Service/storage health |
| `GET /api/config/status` | Connector configuration flags without returning secrets |
| `GET /api/sources` | Source list wrapper |
| `GET /api/news` and `/api/news/:id` | News/demo record wrappers and pagination |
| `GET /api/clusters` and `/api/clusters/:id` | Grouped story data |
| `GET /api/stats` | Stored-data summary |
| `POST /api/admin/login`, `GET /api/admin/session` | Demo administrator session flow |
| `/api/admin/sources`, `/api/admin/news` | Authenticated source/news management |
| `/api/admin/ingest`, `/api/admin/ingestion/run` | Explicit network-ingestion operations |
| `POST /api/telegram/webhook` | Optional authenticated Telegram webhook |

Administrator requests accept `X-Admin-Token` or a bearer token returned by login. The demo has a single administrator password, not a multi-user account system. Sessions are held in memory and expire; restarting the process invalidates them.

## Optional external integrations

RSS/Guardian fetching, Telegram Bot API/MTProto, Gemini translation and manual ingestion are separate operational features. They require deliberate configuration and may send network requests. They were **not exercised against live services** during repository preparation. `npm run telegram:login` is an interactive account-login tool; do not run it merely to preview the project and never commit its session output.

Provider URLs in the catalogue are examples, not live-health assertions. Credentials belong only in your local environment or a deployment secret store. No production account ID, bot token, session string or scraped-news database is included. The optional GramJS package remains at the source project's pinned dependency; no claim is made that it is current or independently audited.

Translation without a configured provider preserves original text and records failure instead of inventing a translation. Demo translations are fixtures. Source tiers and corroboration/grouping states are software heuristics, not verification that an event happened. Full-text storage is disabled by default.

## Verification and deployment boundary

Use `npm run typecheck`, `npm test` and `npm run build` to validate the local source. See [VERIFICATION.md](VERIFICATION.md) for actual preparation results and limitations. Test fixtures do not prove Telegram delivery, provider ingestion, translation quality, Android device behavior or factual news reliability.

The included Dockerfile is optional packaging scaffolding. It was not built or deployed during preparation. The CI workflow checks source/tests/build only and has no deployment, ingestion, Telegram login or secret-management step. Public deployment requires a separate review of authentication/CORS, HTTPS, rate limits, data retention and upstream-service terms; no production-security certification is claimed.

## Source and provenance

```text
src/app.ts               API routes and demo bootstrap
src/db.ts                SQLite schema and data access
src/seed.ts              Synthetic demonstration records
src/security.ts          Parsing, normalization and remote-URL checks
src/services/            Clustering, ingestion and translation logic
src/connectors/          RSS/Guardian and optional Telegram integrations
scripts/                 Seed, test runner and optional Telegram login
test/                    API, security/language and clustering fixtures
.env.example             Blank integrations and explicit local-demo defaults
```

Prepared from the supplied server source that accompanies the Android project. The original source was preserved. This portfolio copy replaces the owner-specific Telegram handle with an example placeholder and changes automatic background polling to opt-in; corresponding fixture expectations are updated. No repository-wide license was present or invented. Dependencies retain their own licenses.

---

## فارسی

این پروژه **API همراه اپ اندروید رادار جنگ ایران** است؛ اپ اندروید یا سایت کامل نمایش خبر در این مخزن قرار ندارد. مسیر اصلی فقط صفحه وضعیت و معرفی API است. کد با Node.js، TypeScript، Express و SQLite داخلی Node اجرا می‌شود.

برای دمو محلی، دستورهای بالا را با Node.js 22.13 یا جدیدتر اجرا کنید، `.env.example` را به `.env` کپی کنید و `npm start` را بزنید. داده‌های آغازین ساختگی و دارای برچسب آزمایشی‌اند. هیچ پایگاه داده واقعی، خبر جمع‌آوری‌شده، نشست تلگرام یا کلید سرویس منتقل نشده است.

پایش خودکار منابع و polling ربات در این نسخه پیش‌فرض خاموش‌اند. رمز `change-me` فقط نمونه عمومی توسعه است؛ برای انتشار قابل استفاده نیست. شناسه کانال شخصی با `@example_public_channel` جایگزین شده است. دریافت خبر، ارسال تلگرام، ترجمه واقعی و ورود MTProto اقدامات جداگانه‌اند و در آماده‌سازی مخزن اجرا نشده‌اند.

نتیجه آزمون و build، اتصال زنده ارائه‌دهندگان، رفتار دستگاه اندروید یا درستی خبر را اثبات نمی‌کند. tier منابع و برچسب‌های خوشه‌بندی فقط قواعد نرم‌افزاری‌اند. گزارش دقیق در [VERIFICATION.md](VERIFICATION.md) آمده است. هیچ استقرار عمومی یا ممیزی مستقل امنیت انجام نشده است.
