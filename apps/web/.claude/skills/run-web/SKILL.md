---
name: run-web
description: Build, run, and drive apps/web (the Next.js/react-native-web app). Use when asked to start apps/web, run its dev server, build it, take a screenshot of its UI, or check that its routes render.
---

apps/web is a Next.js (App Router) app with a sidebar layout and 5 routes. Drive it by starting the dev server, then running `.claude/skills/run-web/driver.mjs` (a headless-Chromium Playwright script) against it — it visits every route, screenshots each, and reports console errors.

All paths below are relative to `apps/web/`, except the driver invocation itself, which is run from the **repo root** (see Run section).

## Prerequisites

Verified on macOS (arm64) in this session — the commands below are OS-agnostic; on a fresh Linux container add `--with-deps` to the browser-install line to also pull the OS-level shared libraries Chromium needs (`libnss3`, `libatk-1.0`, etc. via apt).

```bash
npm install   # from repo root — installs playwright (a devDependency of apps/web)
npx playwright install chromium   # downloads a Playwright-managed Chromium (~280MB); run once per machine
```

## Setup

No env vars or config patches needed — this app has no backend wiring yet (no Supabase URL/key required to view any of the 5 routes).

## Build

Not needed to run the driver (it uses the dev server). To verify a production build compiles:

```bash
cd apps/web && npm run build
```

## Run (agent path)

1. Start the dev server in the background and wait for it to actually serve (don't `sleep` blindly — poll the port):

```bash
cd apps/web
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill 2>/dev/null   # free the port if a previous run is still up
nohup npm run dev > /tmp/pantry-web-dev.log 2>&1 &
i=0; until curl -sf http://localhost:3000 >/dev/null 2>&1 || [ $i -ge 40 ]; do sleep 1; i=$((i+1)); done
curl -sf http://localhost:3000 >/dev/null 2>&1 && echo "SERVER UP" || (echo "SERVER NOT UP"; cat /tmp/pantry-web-dev.log)
```

2. From the **repo root**, run the driver:

```bash
node apps/web/.claude/skills/run-web/driver.mjs
```

It navigates to `/`, `/pantry`, `/recipe`, `/shopping-list`, `/financials`, waits for each to go network-idle, asserts an `<h1>` is present and the response was HTTP 200, and screenshots each page (full-page PNG). It also collects any browser console errors/`pageerror` events across the whole run. Exits 0 and prints `RESULT: PASS` only if every route rendered and no console errors occurred; otherwise exits 1 and prints `RESULT: FAIL` with the specific route/error that failed.

Optional args: `node driver.mjs <baseUrl> <outDir>` (defaults: `http://localhost:3000`, `apps/web/.claude/skills/run-web/screenshots/`).

3. Stop the server when done:

```bash
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill 2>/dev/null
```

Screenshots land in `apps/web/.claude/skills/run-web/screenshots/<route-name>.png` (git-ignored — regenerate rather than expecting them to be committed).

## Run (human path)

```bash
cd apps/web && npm run dev   # -> opens a dev server at http://localhost:3000; open it in a browser. Ctrl-C to stop.
```

## Test

No test script exists yet for apps/web itself (the 5 shared `@pantry/*` packages have their own `npm test`, run from the repo root: `npm run test --workspaces --if-present`). Treat a clean `driver.mjs` run as this app's smoke test until a real test suite exists.

---

## Gotchas

- **`next dev` / `next build` silently ignore `next.config.js`'s `webpack` block on Next 16+** unless you pass `--webpack` explicitly — Next 16 defaults to Turbopack, which doesn't read the `webpack:` key at all. This app's `package.json` scripts already have `--webpack` baked in (`"dev": "next dev --webpack"`), which is *why* the react-native-web alias in `next.config.js` actually takes effect. If you ever "simplify" these scripts back to plain `next dev`, the alias silently stops applying and nothing will error — routes will still render (none of the 5 pages import a `react-native`-only API yet), so this failure mode is invisible until a future page does.
- **`npx playwright install --with-deps` on macOS** doesn't error, it just skips the (Linux-only) OS-dependency step and downloads the browser binaries normally — safe to leave `--with-deps` in a cross-platform script.
- **The repo's own `curl`/`grep` in an interactive shell can behave oddly inside `for` loops** in this specific dev environment (a sandboxing quirk unrelated to the app) — prefer separate sequential commands over a `for path in ...; do curl ...; done` construct if you're driving routes with raw `curl` instead of the Playwright driver.

## Troubleshooting

- **`EADDRINUSE` on port 3000**: a previous `npm run dev` is still holding the port. `npm`'s wrapper process doesn't forward `SIGTERM` to the actual `next` server it spawns, so killing the `npm run dev &` background job's PID does **not** free the port — kill the port's listener directly: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`.
- **Driver reports `status=200 h1=null`**: the page returned OK but no `<h1>` was found before `networkidle` — check `/tmp/pantry-web-dev.log` for a compile error on that route first (a broken import can still return a 200 shell with a Next.js error overlay instead of your component).
