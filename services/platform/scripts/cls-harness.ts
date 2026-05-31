/**
 * Cumulative Layout Shift (CLS) harness for the governance settings pages.
 *
 * Proves the anti-layout-shift work: run it against `main` to capture the
 * "before" numbers, then against this branch for the "after". It is a
 * run-on-demand proof tool, NOT part of CI (CLS is timing-sensitive and would
 * flake the gate).
 *
 * What it does, per route:
 *  - installs a `layout-shift` PerformanceObserver BEFORE navigation so the
 *    first paints are captured,
 *  - forces a fixed viewport + `prefers-reduced-motion: reduce` (so the
 *    content fade-in isn't itself counted as shift),
 *  - navigates, waits for the page to finish loading (no `[aria-busy]` left),
 *  - reads the accumulated CLS,
 *  - repeats N times and reports the median (CLS is noisy).
 *
 * Usage:
 *   # 1. Log into the app in a real browser, then export its storage state:
 *   #    (or reuse an existing Playwright storageState JSON)
 *   CLS_BASE_URL=http://localhost:3000 \
 *   CLS_ORG_ID=<organizationId> \
 *   CLS_STORAGE_STATE=./.cls-auth.json \
 *   bun run scripts/cls-harness.ts
 *
 * Produces a JSON table on stdout: { route, clsMedian, worstShift }.
 */
import { chromium, type Browser, type Page } from 'playwright';

const BASE_URL = process.env.CLS_BASE_URL ?? 'http://localhost:3000';
const ORG_ID = process.env.CLS_ORG_ID;
const STORAGE_STATE = process.env.CLS_STORAGE_STATE;
const RUNS = Number(process.env.CLS_RUNS ?? '5');

if (!ORG_ID) {
  console.error('Set CLS_ORG_ID to the organization id to measure.');
  process.exit(1);
}

// Governance pages with the heaviest historical layout shift. Add more freely.
const GOVERNANCE_PATHS = [
  'content-models',
  'policies-limits',
  'security-monitoring',
  'guardrails',
  'legal-hold',
  'data-subject-requests',
  'trash',
] as const;

const OBSERVER_INIT = `
  window.__cls = 0;
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // Ignore shifts caused by recent user input.
      if (!entry.hadRecentInput) {
        window.__cls += entry.value;
        window.__shifts.push(entry.value);
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
`;

async function measureRoute(page: Page, path: string): Promise<number> {
  await page.addInitScript(OBSERVER_INIT);
  await page.goto(
    `${BASE_URL}/dashboard/${ORG_ID}/settings/governance/${path}`,
    { waitUntil: 'domcontentloaded' },
  );
  // Wait for the skeletonized region(s) to resolve — no aria-busy left.
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), {
      timeout: 15_000,
    })
    .catch(() => {
      console.warn(`  (timed out waiting for load on ${path})`);
    });
  // Let any trailing shift settle.
  await page.waitForTimeout(500);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function main() {
  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
  });

  const results: Array<{
    route: string;
    clsMedian: number;
    worstRun: number;
  }> = [];

  for (const path of GOVERNANCE_PATHS) {
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const page = await context.newPage();
      try {
        samples.push(await measureRoute(page, path));
      } finally {
        await page.close();
      }
    }
    results.push({
      route: path,
      clsMedian: Number(median(samples).toFixed(4)),
      worstRun: Number(Math.max(...samples).toFixed(4)),
    });
    console.log(`✓ ${path}: median CLS ${median(samples).toFixed(4)}`);
  }

  await browser.close();
  console.log('\nCLS results (lower is better):');
  console.table(results);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
