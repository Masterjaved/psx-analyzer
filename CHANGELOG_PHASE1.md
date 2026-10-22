# Phase 1 — Stability & security (changes vs. the uploaded ZIP)

For each change: what was affected → what changed → why → how existing behaviour is preserved → how it was tested.
Tests: `npm test` (47 unit tests) and `node tests/e2e/e2e.js` (14 browser steps) — both against **fake** PSX / Netlify / AI / email backends (no internet in the build environment).

| Area | Files | Change | Why | Preserved / tested |
|---|---|---|---|---|
| Publishing | `netlify.toml`, `public/*` | Site files moved to `public/`; `publish = "public"`; Node 20; security headers; no-cache on html/auth/app | `publish = "."` exposed `package.json`, README and function source publicly | Same URLs (`/`, `/portfolio.html`, `/admin.html`, `/api/*`); redirects + cron schedule unchanged |
| XSS | `public/esc.js`, `app.js`, `portfolio.html`, `admin.html`, `auth.js`, `lib/html.js` | Everything from users / PSX / AI / news is escaped; links limited to http(s) | Stored XSS: a user's saved symbol or a news headline could run script in the admin's browser and steal the token | e2e: XSS payloads shown as text; admin page inert |
| Input validation | `lib/validate.js`, `portfolio.js`, `analyze.js`, `quotes.js`, `intraday.js`, `lib/http.js` | Symbol regex, positive numbers, date/strategy whitelist, max 200 holdings, 100 KB body cap | Server saved any JSON; symbols went straight into URLs and AI prompts | Same data shape (`{email, holdings, updatedAt}`); old holdings still load (ids added on read) |
| Cloud sync safety | `portfolio.js`, `portfolio.html` | `baseUpdatedAt` check → 409 + fresh data if another device saved first; delete confirmation | Phone + computer could silently overwrite each other | e2e: "TWO DEVICES", "CLOUD SYNC", "USER ISOLATION" |
| Prices | `quotes.js` (new), `portfolio.html`, `psxData.js` | Portfolio uses AI-free `/api/quotes` (30 symbols); every price shows source + as-of date; 5-min in-memory history cache | Portfolio page called AI for every holding and ignored holdings after the 10th | unit + e2e |
| Reliability | `lib/net.js`, `lib/pool.js`, `analyze.js`, `aiProviders.js`, `email.js`, `newsFetch.js` | Timeouts on every outbound call, bounded parallelism, 8.5 s budget shared by AI fallbacks | 10-symbol requests were sequential and could hit Netlify's ~10 s limit | Provider order/fallback unchanged |
| Data honesty | `analyze.js`, `indicators.js` | < 30 daily closes → "Insufficient data for reliable analysis"; RSI returns 100 (not 50) when there were no losses | Avoid meaningless indicators; fix overbought stocks shown as neutral | unit tests |
| News | `lib/newsFetch.js` | De-duplicated, keeps source / date / link; nothing AI-generated | Same story appeared several times | unit tests |
| Alerts | `daily-alert-check.js`, `admin.html` | Only scheduler or logged-in admin may run it; `?dryRun=1`; one price fetch per symbol per run; alert state saved only after the email succeeds; emails escaped | Anyone with the URL could trigger emails; failed emails were lost | e2e: URL no longer public; unit tests |
| Auth client | `public/auth.js` | No tokens/URLs in console; silent token refresh and one retry on 401 | Token leak in logs; long-open tabs failed | e2e: expired + revoked token |
| Admin | `admin.html`, `debug-env.js`, `admin-portfolios.js` | Tools panel (key status, dry run, run now); Supabase vars shown as set/not set only | Easier diagnosis without exposing values | e2e: normal user blocked |
| Repo hygiene | `.gitignore`, `.env.example`, `package.json`, `README.md`, `README_URDU.md` | Env documentation, engines, test script | GitHub-ready | — |
| Phase 2 prep | `supabase/migrations/001–003` | Schema for all 8 tables, RLS (own rows only; admin read-only on portfolios/transactions), indexes | Prepared only — **not connected to the app** | **Not run on a real Postgres/Supabase** |

## Not done yet (later phases)
Supabase Auth + cloud portfolio + transaction ledger (BUY/SELL/…), candlestick chart, fundamentals, market scanner, portfolio AI status, extra alert types, comparison, risk dashboard, sectors, Shariah info, exports.
