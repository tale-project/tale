// Turnkey CLI: analyze a LIVE url end-to-end. Launches its own browser
// (Playwright, optional dep), injects the instrument, drives the session, and
// prints the JSON report to stdout. Run directly with Bun — no build step.
//
//   bun src/analyze-cli.ts <url> [--full]
//
// Everything that matters is on by default: the instrument auto-detects the
// page's relevant elements (a scored selection of component roots + media +
// active elements), and pixel capture (dithering + the paint check) and
// auto-scroll (lazy content + CLS) always run, so a bare run never silently
// misses a defect. The only flag is `--full` (the faithful Report instead of the
// lean compact one). The health summary always goes to stderr, so stdout stays
// pure JSON — redirect it with your shell to save it.

import { buildInstrumentBundle } from './bundle';
import { compactReport } from './compact';
import { analyzeSession, type Clip, type PageLike } from './driver';
import { summarize } from './summarize';
import type { Report } from './types';

type PwPage = PageLike & {
  screenshot: (opts: { clip: Clip }) => Promise<Uint8Array>;
  close: () => Promise<void>;
};
type PwBrowser = { newPage: () => Promise<PwPage>; close: () => Promise<void> };
type PwModule = {
  chromium: { launch: (opts?: { headless?: boolean }) => Promise<PwBrowser> };
};

type Args = {
  url: string | undefined;
  full: boolean;
  help: boolean;
};

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { url: undefined, full: false, help: false };
  const positionals: string[] = [];
  for (const token of argv) {
    if (!token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const flag = eq >= 0 ? token.slice(0, eq) : token;
    switch (flag) {
      case '--full':
        args.full = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      // Unknown flags are ignored (lenient), like the prior CLI.
    }
  }
  // The first bare token is the url; any further positionals are ignored (the
  // page audits itself — there are no selectors to pass).
  args.url = positionals[0];
  return args;
}

const USAGE = `usage: analyze <url> [--full]
  <url>     the page to analyze (required); its relevant elements are auto-detected
  --full    emit the faithful Report instead of the compact one`;

async function loadPlaywright(): Promise<PwModule | null> {
  const specifier = ['play', 'wright'].join('');
  try {
    return await import(specifier);
  } catch (error) {
    // Absent dependency → null, so main() prints the install hint. Re-throw any
    // OTHER failure (a broken or half-installed playwright, a transitive load
    // error) so it surfaces instead of masquerading as "playwright is required".
    const message = error instanceof Error ? error.message : String(error);
    if (/cannot find (module|package)/i.test(message)) return null;
    throw error;
  }
}

// Scroll the page in steps so lazy content loads and CLS fires while sampling.
export async function autoScroll(page: PageLike): Promise<void> {
  for (let i = 1; i <= 6; i++) {
    await page.evaluate(
      `window.scrollTo(0, document.body.scrollHeight * ${i / 6})`,
    );
    await page.waitForTimeout(120);
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

export function renderSummary(report: Report): string {
  const s = summarize(report);
  const lines = [s.headline];
  const audit = report.session.audit;
  if (audit) {
    lines.push(
      audit.capped
        ? `page audit: ${audit.discovered} elements (capped — some not tracked)`
        : `page audit: ${audit.discovered} elements`,
    );
  }
  // Prefer the element's role+name label over its bare selector in the glance.
  const labelBy = new Map(report.elements.map((e) => [e.selector, e.label]));
  if (s.worst.length > 0) {
    lines.push('worst:');
    for (const d of s.worst) {
      const times = d.count > 1 ? ` ×${d.count}` : '';
      const who = labelBy.get(d.selector) ?? d.selector;
      lines.push(
        `  [${d.severity.toFixed(2)}${times}] ${d.type} ${who} — ${d.detail}`,
      );
    }
  }
  if (s.hints.length > 0) {
    lines.push('hints:');
    for (const hint of s.hints) lines.push(`  - ${hint}`);
  }
  return lines.join('\n');
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.url === undefined) {
    console.error(USAGE);
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const pw = await loadPlaywright();
  if (!pw) {
    console.error(
      'playwright is required: bun add -d playwright && bunx playwright install chromium',
    );
    process.exitCode = 1;
    return;
  }

  const instrumentBundle = await buildInstrumentBundle();
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const report = await analyzeSession(page, {
      url: args.url,
      instrumentBundle,
      capturePixels: true,
      interact: autoScroll,
    });
    const output = args.full ? report : compactReport(report);
    console.log(JSON.stringify(output, null, 2));
    console.error(renderSummary(report));
  } finally {
    await browser.close();
  }
}

/**
 * Run main(), reducing any throw (a bad flag, missing browser, or navigation
 * failure) to a one-line error and a non-zero exit code rather than an
 * unhandled-rejection stack trace. Exported so the wrapper is unit-testable; the
 * `import.meta.main` guard below is only true when the file is the process entry.
 */
export async function runCliEntry(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

// Only run when invoked directly (`bun src/analyze-cli.ts …`), not when imported.
if (import.meta.main) await runCliEntry();
