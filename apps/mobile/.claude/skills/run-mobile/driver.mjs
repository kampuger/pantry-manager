#!/usr/bin/env node
// Drives apps/mobile via Expo's web target (`expo start --web`), rendered
// under headless Chromium through react-native-web. This environment has
// no iOS Simulator or Android emulator, so this is the only way to get a
// real, interactive screenshot of the actual React Native app (not just a
// bundle-compiles check) without native tooling.
//
// Signs up a throwaway test user, walks the app through all 5 bottom
// tabs, creates a household, and signs out — screenshotting each step —
// then cleans up the household/pantry rows it created via REST. It
// cannot delete the throwaway auth user itself (that needs a
// service_role key, which this script intentionally never touches) —
// see the printed note at the end of every run.
//
// Usage: node driver.mjs [baseUrl] [outDir]
//   baseUrl defaults to http://localhost:8081 (Expo web dev server)
//   outDir  defaults to ./screenshots (relative to this file)

import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] || 'http://localhost:8081';
const outDir = process.argv[3] || path.join(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

// Plain `node` doesn't load apps/mobile/.env.local the way Expo's CLI
// does, so this driver reads it directly for the REST cleanup calls.
const envPath = path.join(__dirname, '..', '..', '..', '.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx), l.slice(idx + 1)];
    })
);
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error(`Could not read EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY from ${envPath}`);
  process.exit(1);
}

const email = `pantry.mobile.${Date.now()}@gmail.com`;
const password = 'correcthorsebattery';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(e.message));

let failures = 0;
let shotIndex = 1;
async function shot(name) {
  const file = path.join(outDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shotIndex++;
  return file;
}

function check(label, ok) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}

// IMPORTANT: this polls ALL matches for the marker text, not just the
// first. Two things make that necessary here:
//   1. locator.isVisible() checks the DOM at that exact instant and does
//      not poll — despite accepting a `timeout` option, it does not wait
//      for an element that hasn't rendered yet. Right after a tab click,
//      that's a race: it can return false simply because React hasn't
//      repainted yet.
//   2. react-native-web on this Expo dev server leaves an invisible
//      duplicate of each screen's heading in the DOM the first time you
//      navigate to it (looks like a React StrictMode double-mount
//      artifact — harmless, dev-only). `.first()` matches DOM order, not
//      visibility, so it can land on the invisible ghost node forever
//      while a second, visible copy of the same text sits right next to
//      it. Checking every match for visibility sidesteps that entirely.
async function waitVisible(marker, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const loc = page.locator(marker);
    const count = await loc.count();
    for (let i = 0; i < count; i++) {
      if (await loc.nth(i).isVisible().catch(() => false)) return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

console.log(`Loading ${baseUrl} ...`);
await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
check('Sign in screen renders', await waitVisible('text=Sign in'));
await shot('login');

console.log(`Signing up as ${email} ...`);
await page.fill('input[placeholder="Email"]', email);
await page.fill('input[placeholder="Password"]', password);
await page.click('text=Need an account? Sign up');
await page.click('text=Sign up');
check('Dashboard visible after sign-up', await waitVisible('text=Dashboard'));
await shot('dashboard');

const tabs = [
  { label: 'Pantry', marker: 'text=Pantry Inventory' },
  { label: 'Recipe', marker: 'text=Recipe Ingredient Checker' },
  { label: 'Shop', marker: 'text=Shopping List' },
  { label: 'Financial', marker: 'text=Financial snapshot' },
];
for (const tab of tabs) {
  // Quoted text= is an EXACT match in Playwright — required here because
  // unquoted substring matching makes e.g. "Shop" ambiguously match both
  // the tab bar button and the "Shopping List" page heading, and Playwright
  // silently proceeds with whichever it finds first (often the wrong one).
  await page.click(`text="${tab.label}"`);
  const ok = await waitVisible(tab.marker);
  check(`${tab.label} tab shows expected content`, ok);
  await shot(tab.label.toLowerCase());
}

console.log('Creating a household from the Pantry tab ...');
await page.click('text="Pantry"');
await page.waitForSelector('text=not part of a household yet', { timeout: 20000 });
await page.fill('input[placeholder="Household name"]', 'Mobile Test Household');
await page.click('text=Create household');
check('Household created, empty pantry state shows', await waitVisible('text=No pantry items yet.'));
await shot('pantry-with-household');

console.log('Signing out from the Home tab ...');
await page.click('text="Home"');
await page.click('text=Sign out');
check('Back at Sign in screen after sign-out', await waitVisible('text=Sign in'));
await shot('signed-out');

await browser.close();

console.log(`\nConsole errors: ${consoleErrors.length ? consoleErrors.join(' | ') : 'none'}`);

// Best-effort cleanup of the household/pantry rows this run created.
try {
  const tokenResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await tokenResp.json();
  const accessToken = session.access_token;
  const userId = session.user?.id;

  if (accessToken && userId) {
    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` };
    const memberResp = await fetch(
      `${SUPABASE_URL}/rest/v1/household_members?select=household_id&user_id=eq.${userId}`,
      { headers }
    );
    const [member] = await memberResp.json();
    if (member) {
      const householdId = member.household_id;
      await fetch(`${SUPABASE_URL}/rest/v1/pantry_items?household_id=eq.${householdId}`, {
        method: 'DELETE',
        headers,
      });
      await fetch(`${SUPABASE_URL}/rest/v1/household_members?household_id=eq.${householdId}`, {
        method: 'DELETE',
        headers,
      });
      await fetch(`${SUPABASE_URL}/rest/v1/households?id=eq.${householdId}`, { method: 'DELETE', headers });
      console.log(`Cleaned up test household ${householdId}.`);
    }
    console.log(
      `NOTE: throwaway auth user ${email} (id ${userId}) still exists in Supabase Auth — deleting it requires a service_role key, which this script intentionally never uses. Clear it from the dashboard periodically.`
    );
  }
} catch (err) {
  console.log(`Cleanup step failed (non-fatal): ${err instanceof Error ? err.message : err}`);
}

if (failures > 0 || consoleErrors.length > 0) {
  console.log(`\nRESULT: FAIL (${failures} check failure(s), ${consoleErrors.length} console error(s))`);
  process.exit(1);
} else {
  console.log('\nRESULT: PASS');
}
