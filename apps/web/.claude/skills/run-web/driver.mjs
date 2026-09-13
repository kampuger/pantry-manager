#!/usr/bin/env node
// Drives apps/web with a headless Chromium via Playwright: visits every
// sidebar route, screenshots each, and reports any console errors.
//
// Usage: node driver.mjs [baseUrl] [outDir]
//   baseUrl defaults to http://localhost:3000
//   outDir  defaults to ./screenshots (relative to this file)

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = process.argv[2] || 'http://localhost:3000';
const outDir = process.argv[3] || path.join(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

const ROUTES = [
  { path: '/', name: 'dashboard' },
  { path: '/pantry', name: 'pantry' },
  { path: '/recipe', name: 'recipe' },
  { path: '/shopping-list', name: 'shopping-list' },
  { path: '/financials', name: 'financials' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));

let failures = 0;
for (const route of ROUTES) {
  const url = `${baseUrl}${route.path}`;
  const resp = await page.goto(url, { waitUntil: 'networkidle' });
  const status = resp ? resp.status() : 'no-response';
  const h1 = await page.locator('h1').first().textContent().catch(() => null);
  const screenshotPath = path.join(outDir, `${route.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const ok = status === 200 && !!h1;
  if (!ok) failures++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${route.path.padEnd(16)} status=${status} h1=${JSON.stringify(h1)} -> ${screenshotPath}`);
}

await browser.close();

if (consoleErrors.length) {
  console.log(`\n${consoleErrors.length} console error(s):`);
  for (const e of consoleErrors) console.log(`  ${e}`);
} else {
  console.log('\nNo console errors.');
}

if (failures > 0 || consoleErrors.length > 0) {
  console.log(`\nRESULT: FAIL (${failures} route failure(s), ${consoleErrors.length} console error(s))`);
  process.exit(1);
} else {
  console.log('\nRESULT: PASS');
}
