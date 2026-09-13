---
name: run-mobile
description: Build, run, and drive apps/mobile (the Expo/React Native app). Use when asked to start apps/mobile, run its dev server, take a screenshot of its UI, or check that its screens render — including when no iOS Simulator or Android emulator is available.
---

apps/mobile is an Expo (managed workflow) app with a bottom-tab navigator, gated behind sign-in. This environment has no iOS Simulator or Android emulator (`xcrun simctl` and the Android `emulator` binary are both unavailable) — drive it instead via **Expo's web target** (`expo start --web`), which renders the actual React Native components through `react-native-web` in a real browser. `.claude/skills/run-mobile/driver.mjs` (a headless-Chromium Playwright script) walks the full app through that target: sign up, visit all 5 tabs, create a household, sign out.

This is not a lesser substitute for "really" running the app — the same React components, the same business logic, the same Supabase calls execute either way. Only truly native-only code (a real camera, native modules) wouldn't be exercised this way; this app doesn't have any yet.

All paths below are relative to `apps/mobile/`, except the driver invocation itself, which is run from the **repo root** (see Run section).

## Prerequisites

Verified on macOS (arm64) in this session — the commands below are OS-agnostic; on a fresh Linux container add `--with-deps` to the browser-install line to also pull the OS-level shared libraries Chromium needs.

```bash
npm install   # from repo root — apps/web already carries playwright as a devDependency; it's hoisted and reused here
npx playwright install chromium   # downloads a Playwright-managed Chromium (~280MB); run once per machine
```

`react-native-web` itself doesn't need installing here either — it's a dependency of `apps/web` and resolves for `apps/mobile` via npm workspace hoisting to the repo root `node_modules/`.

## Setup

Requires `apps/mobile/.env.local` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `apps/mobile/.env.example`). The driver reads this file directly (plain `node`, unlike Expo's CLI, doesn't load it) to make its own REST cleanup calls after the run.

## Build

Not applicable in the EAS/app-store sense for this smoke-test path. To confirm the native bundle itself compiles (a different, narrower check than this skill's driver — proves Metro resolves everything, not that the UI renders):

```bash
cd apps/mobile
lsof -ti:8081 -sTCP:LISTEN | xargs -r kill 2>/dev/null
nohup npx expo start --non-interactive > /tmp/pantry-mobile-expo.log 2>&1 &
i=0; until curl -sf http://localhost:8081/status >/dev/null 2>&1 || [ $i -ge 40 ]; do sleep 1; i=$((i+1)); done
curl -s "http://localhost:8081/apps/mobile/index.bundle?platform=ios&dev=true" -o /tmp/b.js -w "HTTP %{http_code}, %{size_download} bytes\n" --max-time 60
lsof -ti:8081 -sTCP:LISTEN | xargs -r kill 2>/dev/null
```

Note the URL path prefix `apps/mobile/` before `index.bundle` — this is a monorepo, and Metro's project root resolves to the repo root, not `apps/mobile/`; a bare `/index.bundle` 404s.

## Run (agent path)

1. Start Expo's web dev server in the background and wait for it to actually serve:

```bash
cd apps/mobile
lsof -ti:8081 -sTCP:LISTEN | xargs -r kill 2>/dev/null
nohup npx expo start --web --non-interactive > /tmp/pantry-mobile-web.log 2>&1 &
i=0; until curl -sf http://localhost:8081 >/dev/null 2>&1 || [ $i -ge 40 ]; do sleep 1; i=$((i+1)); done
curl -sf http://localhost:8081 >/dev/null 2>&1 && echo "SERVER UP" || (echo "SERVER NOT UP"; cat /tmp/pantry-mobile-web.log)
```

(`--non-interactive` prints a harmless "not supported, use $CI=1 instead" warning and proceeds anyway — safe to ignore.)

2. From the **repo root**, run the driver:

```bash
node apps/mobile/.claude/skills/run-mobile/driver.mjs
```

It signs up a fresh throwaway user (timestamped email), waits for the Dashboard tab, clicks through Pantry / Recipe / Shop / Financial, creates a household from the Pantry tab, signs out, and screenshots every step (full-page PNG, numbered in order). It also collects browser console errors/`pageerror` events across the whole run. Exits 0 and prints `RESULT: PASS` only if every check passed and no console errors occurred; otherwise exits 1 with the specific failing check named.

At the end it deletes the household/pantry rows it created via REST (using the throwaway user's own session — no service_role key involved) and prints a note that the throwaway **auth user itself is left behind** — deleting an Auth user requires a service_role key, which this script intentionally never touches. Clear accumulated `pantry.mobile.*@gmail.com` test accounts from the Supabase dashboard periodically.

Optional args: `node driver.mjs <baseUrl> <outDir>` (defaults: `http://localhost:8081`, `apps/mobile/.claude/skills/run-mobile/screenshots/`).

3. Stop the server when done:

```bash
lsof -ti:8081 -sTCP:LISTEN | xargs -r kill 2>/dev/null
```

Screenshots land in `apps/mobile/.claude/skills/run-mobile/screenshots/NN-name.png` (git-ignored — regenerate rather than expecting them to be committed).

## Run (human path)

```bash
cd apps/mobile && npx expo start   # -> prints a QR code + dev server URL; scan with Expo Go, or press `i`/`a` for a simulator if one is configured. Ctrl-C to stop.
```

## Test

No test script exists for apps/mobile itself (the 5 shared `@pantry/*` packages have their own `npm test`, run from the repo root: `npm run test --workspaces --if-present`). Treat a clean `driver.mjs` run as this app's smoke test until a real test suite exists.

---

## Gotchas

- **`locator.isVisible()` does not wait or poll**, despite accepting a `timeout` option — it checks the DOM at that exact instant. Calling it immediately after a `page.click()` (e.g. a tab switch) races React's re-render and fails intermittently for no code reason. Use `locator.waitFor({ state: 'visible', timeout })`-style polling instead — `driver.mjs`'s `waitVisible()` helper does this.
- **react-native-web (via this Expo dev server) leaves an invisible duplicate of a screen's heading in the DOM the first time you navigate to it** — looks like a React StrictMode double-mount artifact in dev mode, and is harmless to real users. But `locator(...).first()` matches DOM order, not visibility, so it can permanently latch onto the invisible ghost node while a second, visible copy of the identical text sits right next to it — a check built on `.first()` alone will hang or fail forever even though the screen is genuinely fine. `waitVisible()` checks every match for visibility, not just the first, specifically because of this.
- **Playwright's unquoted `text=Foo` is a case-insensitive substring match, not exact.** `text=Shop` matches both the "Shop" tab bar button AND the "Shop**ping List**" page heading — Playwright silently proceeds with whichever it finds first, which is often not the one you meant to click. Use quoted `text="Shop"` for exact-match clicks on short tab labels; this bit both the "Shop" and "Pantry" tab clicks here (the latter collided with a since-removed redundant native header — see below).
- **The bottom-tab navigator had a redundant native header bar duplicating each screen's own in-content title** (e.g. a header reading "Pantry" stacked above the screen's own "Pantry Inventory" heading) — this was real UI clutter, not just a test-automation problem, and is now fixed via `screenOptions={{ headerShown: false }}` in `BottomTabs.tsx`. If it reappears, re-check that option.
- **Bare `/index.bundle` 404s in this monorepo** — Metro's project root resolves to the repo root, not `apps/mobile/`, so bundle requests need the `apps/mobile/` path prefix (see Build section). This only matters for the native-bundle compile check, not the web-target driver.
- **Multiple tab screens fetch concurrently and stay mounted.** React Navigation's bottom-tabs keeps previously-visited screens mounted (not lazily unmounted), so Pantry/Recipe/Shop can all have in-flight Supabase requests at once after a fast walk-through. Real, sometimes-multi-second latency against the live project is normal here — this is why the driver's `waitVisible()` polls up to 20s rather than checking once.

## Troubleshooting

- **`EADDRINUSE` on port 8081**: a previous `expo start` is still holding the port. Kill the port's listener directly: `lsof -ti:8081 -sTCP:LISTEN | xargs -r kill`.
- **Driver hangs or times out on a specific tab check with no console errors**: re-read the two Gotchas above about `isVisible()` not polling and the invisible-duplicate-node issue before assuming it's an app bug — both looked exactly like a hung/broken screen until inspected closely, and neither was.
- **`Could not read EXPO_PUBLIC_SUPABASE_URL / ...` from the driver**: `apps/mobile/.env.local` is missing or empty — copy `.env.example` and fill in real values.
