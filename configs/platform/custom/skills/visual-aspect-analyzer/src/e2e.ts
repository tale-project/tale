// End-to-end verification: serve the fixture pages, drive each with a real
// browser through the driver, and assert the analyzed report. Playwright is an
// optional dependency — this script skips cleanly when it (or a browser binary)
// is unavailable, so the gate never hard-fails on a machine without one.
//
//   bun add -d playwright && bunx playwright install chromium
//   bun scripts/e2e.ts

import { buildInstrumentBundle } from './bundle';
import { analyzeSession, type PageLike } from './driver';
import type { Report } from './types';

type Clip = { x: number; y: number; width: number; height: number };
type PwPage = PageLike & {
  screenshot: (opts: { clip: Clip }) => Promise<Uint8Array>;
  close: () => Promise<void>;
};
type PwBrowser = { newPage: () => Promise<PwPage>; close: () => Promise<void> };
type PwModule = {
  chromium: { launch: (opts?: { headless?: boolean }) => Promise<PwBrowser> };
};

type Scenario = {
  file: string;
  capturePixels?: boolean;
  interact?: (page: PageLike) => Promise<void>;
  check: (report: Report) => string | null;
};

// Every run is now a whole-page audit: the instrument auto-detects the page's
// relevant elements (scored component roots + seeded media + active elements),
// so each scenario asserts the defect/anchor it expects surfaces from discovery,
// with no element named.
const scenarios: Scenario[] = [
  {
    // A fixed nav stays in the viewport while the page scrolls under it on both
    // axes — the signature of a screen anchor.
    file: 'fixed-bar.html',
    interact: async (page) => {
      for (let y = 250; y <= 1000; y += 250) {
        await page.evaluate(`window.scrollTo(${y / 2}, ${y})`);
        await page.waitForTimeout(60);
      }
    },
    check: (r) => {
      if (!r.session.audit?.wholePage) return 'not a whole-page audit';
      const bar = r.elements.find((e) => e.selector.includes('bar'));
      if (!bar) return 'fixed nav not auto-detected';
      return bar.anchoredTo === 'screen'
        ? null
        : `bar anchoredTo=${bar.anchoredTo}`;
    },
  },
  {
    file: 'push-footer.html',
    check: (r) =>
      r.defects.some((d) => d.type === 'layout-shift')
        ? null
        : 'audit missed the layout shift',
  },
  {
    // The promo grows and pushes the in-flow column; at least one item must come
    // back as affected, and the absolutely-positioned #floating must not.
    file: 'affected-cascade.html',
    check: (r) => {
      const shift = r.defects.some((d) => d.type === 'layout-shift');
      const affected = r.elements.some((e) => e.source === 'affected');
      if (!shift && !affected) return 'audit missed the cascade';
      const floating = r.elements.find((e) => e.selector.includes('floating'));
      if (floating && floating.source === 'affected')
        return '#floating (absolute) wrongly reported as affected';
      return null;
    },
  },
  {
    file: 'flicker.html',
    check: (r) =>
      r.defects.some((d) => d.type === 'flicker')
        ? null
        : 'audit missed flicker',
  },
  {
    file: 'shimmer.html',
    capturePixels: true,
    check: (r) =>
      r.defects.some((d) => d.type === 'dithering')
        ? null
        : 'audit missed the dithering on the seeded canvas',
  },
  {
    file: 'spa.html',
    check: (r) =>
      r.session.segments.length >= 2 ? null : 'audit missed the SPA segment',
  },
  {
    // A real inline <svg> (lowercase namespaced tagName) must be seeded as media
    // and reported as a painting element, not silently dropped.
    file: 'svg-media.html',
    check: (r) => {
      const svg = r.elements.find((e) => e.selector.includes('logo'));
      if (!svg) return 'inline svg not auto-detected as media';
      return svg.impactMode.includes('paints')
        ? null
        : `svg impactMode=${svg.impactMode.join(',')}`;
    },
  },
  {
    // A widget whose only signal is a click listener bound ~100ms after load
    // (no DOM mutation) must still be re-scored and tracked.
    file: 'late-listener.html',
    check: (r) =>
      r.elements.some((e) => e.selector.includes('lazy'))
        ? null
        : 'late-bound listener widget was not re-scored / tracked',
  },
  {
    // Width grows while opacity drifts sub-epsilon per frame: only the
    // whole-interval range reveals the fade, so the move/resize is a composite.
    file: 'composite-fade.html',
    check: (r) =>
      r.transitions.some((t) => t.kind === 'composite')
        ? null
        : 'slow fade during resize was not detected as composite',
  },
  {
    // A near-frozen crawl with two lurches is ONE motion; jank must see both
    // teleports rather than splitting them into un-flaggable singletons.
    file: 'jank-stutter.html',
    check: (r) =>
      r.defects.some((d) => d.type === 'jank')
        ? null
        : 'freeze-then-lurch stutter was not flagged as jank',
  },
  {
    // A transparent overlay makes #real look occluded; the paint counterfactual
    // must recover the auto-detected card as a painting element.
    file: 'occlusion.html',
    capturePixels: true,
    check: (r) => {
      const real = r.elements.find((e) => e.selector.includes('real'));
      if (!real) return '#real was not auto-detected / was dropped';
      if (r.defects.some((d) => d.type === 'flicker'))
        return 'false flicker leaked from the paint probe';
      return real.impactMode.includes('paints')
        ? null
        : `#real impactMode=${real.impactMode.join(',')}`;
    },
  },
];

async function loadPlaywright(): Promise<PwModule | null> {
  // Computed specifier so `tsc` doesn't require the optional module to resolve.
  const specifier = ['play', 'wright'].join('');
  try {
    const imported = await import(specifier);
    return imported;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const pw = await loadPlaywright();
  if (!pw) {
    console.log('e2e skipped: playwright not installed (optional).');
    return;
  }

  const instrumentBundle = await buildInstrumentBundle();
  const fixturesDir = new URL('../tests/fixtures/', import.meta.url).pathname;

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      return new Response(Bun.file(fixturesDir + pathname.replace(/^\//, '')));
    },
  });
  const base = `http://localhost:${server.port}`;

  let browser: PwBrowser | null = null;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (err) {
    console.log('e2e skipped: no browser binary (run playwright install)', err);
    server.stop(true);
    return;
  }

  let failures = 0;
  for (const scenario of scenarios) {
    const label = scenario.file;
    const page = await browser.newPage();
    try {
      const report = await analyzeSession(page, {
        url: `${base}/${scenario.file}`,
        instrumentBundle,
        keyframes: 5,
        settleMs: 150,
        capturePixels: scenario.capturePixels ?? false,
        ...(scenario.interact ? { interact: scenario.interact } : {}),
      });
      const error = scenario.check(report);
      if (error) {
        failures++;
        console.error(`FAIL ${label}: ${error}`);
      } else {
        console.log(`pass ${label}`);
      }
    } catch (err) {
      failures++;
      console.error(`FAIL ${label}: threw`, err);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  server.stop(true);
  if (failures > 0) process.exitCode = 1;
}

await main();
