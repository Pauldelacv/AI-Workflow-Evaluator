/**
 * Regenerate the README screenshots.
 *
 * Not part of the default dependencies - screenshots are refreshed rarely and
 * Playwright is a heavy install for every contributor:
 *
 *   npm run seed
 *   npm run build && npm run start &
 *   npm install -D playwright --no-save
 *   node scripts/screenshots.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.AWE_BASE_URL ?? 'http://localhost:3111';
// Set CHROMIUM_PATH when the local Chromium is not the build Playwright expects.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const OUT = 'docs/images';

const shots = [
  { name: 'dashboard', path: '/' },
  { name: 'run-detail', path: null, resolve: (runs) => `/runs/${runs.v1}` },
  { name: 'compare', path: null, resolve: (runs) => `/compare?baseline=${runs.v2}&candidate=${runs.v3}` },
  { name: 'case-detail', path: null, resolve: (runs) => `/runs/${runs.v1}/cases/case-014` },
];

const response = await fetch(`${BASE}/api/runs`);
const { runs } = await response.json();
const byVersion = Object.fromEntries(
  ['v1-baseline', 'v2-grounded', 'v3-cost-optimised'].map((version) => [
    version.slice(0, 2),
    runs.find((run) => run.workflowVersion === version)?.id,
  ]),
);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

for (const shot of shots) {
  const target = shot.path ?? shot.resolve(byVersion);
  await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });
  console.log(`${OUT}/${shot.name}.png  <-  ${target}`);
}

await browser.close();
