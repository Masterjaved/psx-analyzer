# PSX Analyzer

Bilingual (Urdu / English) Pakistan Stock Exchange analyzer: technical indicators, AI commentary (Claude → Gemini → Groq → optional Ollama fallback), news headlines, private per-user portfolios, admin view and a daily email alert. Runs entirely on **GitHub → Netlify (static site + Netlify Functions)**.

Live site: https://psx-analyzer.netlify.app/ — full Urdu setup guide: [`README_URDU.md`](README_URDU.md).

## Layout
```
public/               static site served by Netlify (index, portfolio, admin, supabaseClient.js, auth.js, app.js …)
netlify/functions/    analyze, quotes, intraday, portfolio, admin-portfolios, daily-alert-check, debug-env, lib/
supabase/migrations/  001 schema · 002 RLS policies · 003 indexes   (Phase 2 — not wired into the app yet)
tests/                node:test unit tests + optional Playwright e2e
netlify.toml          publish = "public", functions dir, /api/* redirect, cron schedule, security headers
.env.example          every environment variable (set real values only in Netlify)
```

## Deploy
1. Push this repo to GitHub, import it in Netlify (build command empty; `netlify.toml` provides the rest).
2. Netlify → Site configuration → Environment variables: add the keys from `.env.example` (server-side only; never commit real keys).
3. Enable Netlify Identity, registration **Invite only**, invite users; give the admin `{"roles":["admin"]}` in App metadata.
4. Every push to `main` redeploys.

## Test
```
npm test                    # 47 unit tests, no network needed
node tests/e2e/e2e.js       # optional browser test (needs: npm i -D playwright && npx playwright install chromium)
```

## Status
Phase 1 (stability, security) and Phase 2 (Supabase Auth + cloud portfolio with full BUY/SELL/DIVIDEND/BONUS/RIGHTS/SPLIT transaction history, watchlist, admin view — all RLS-protected, no service-role key used anywhere) are done. See `CHANGELOG_PHASE1.md` / `CHANGELOG_PHASE2.md` and the "Honestly untested" section of `CHANGELOG_PHASE2.md` — none of Phase 2 has run against a real Supabase project yet. Phases 3–6 (charts, fundamentals, scanner, more alerts, comparison, risk, sectors, Shariah, exports) are not built.

AI output is informational only and not investment advice.
