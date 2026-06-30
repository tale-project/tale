// Tests for the live-analysis CLI (analyze-cli.ts): the pure `parseArgs`, the
// exported `main()` over its happy / --full / usage / help / no-browser paths,
// the private `loadPlaywright` re-throw branch (reached through main), the
// `autoScroll` driver hook, and `renderSummary`. The dynamic `import('playwright')`
// is the one external edge, stubbed with `mock.module` so a fake
// chromium/browser/page stands in for a real launch. The `import.meta.main`
// wrapper (only true when the file is the process entry, never on import) is
// exercised out-of-process via `Bun.spawn`.

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { PNG } from 'pngjs';

import {
  autoScroll,
  main,
  parseArgs,
  renderSummary,
  runCliEntry,
} from './analyze-cli';
import type { Clip, PageLike } from './driver';
import { rect, recording, sample, track } from './test-fixtures';
import type { Defect, Report, ReportElement, Segment } from './types';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// A 2×2 grey PNG; `capturePixelFrame` only needs a decodable image.
function tinyPng(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data = Buffer.alloc(2 * 2 * 4, 128);
  return PNG.sync.write(png);
}

// The recording the fake page returns for `__VA.dump()`: one tracked element,
// no defects, so the happy path renders a clean summary.
const dumpJson = JSON.stringify(
  recording([
    track({
      key: 'va-1',
      selector: '#hero',
      samples: [sample({ t: 0, frame: 0, screen: rect(0, 100, 50, 0) })],
    }),
  ]),
);

type FakePage = PageLike & {
  screenshot: (opts: { clip: Clip }) => Promise<Uint8Array>;
  close: () => Promise<void>;
};

type PageTrace = {
  initScripts: string[];
  gotos: string[];
  evaluations: string[];
  scrolls: string[];
  waits: number;
  closed: boolean;
};

function fakePage(): { page: FakePage; trace: PageTrace } {
  const trace: PageTrace = {
    initScripts: [],
    gotos: [],
    evaluations: [],
    scrolls: [],
    waits: 0,
    closed: false,
  };
  const page: FakePage = {
    addInitScript: async (script) => {
      trace.initScripts.push(script);
    },
    goto: async (url) => {
      trace.gotos.push(url);
    },
    waitForTimeout: async () => {
      trace.waits++;
    },
    evaluate: async (expression) => {
      trace.evaluations.push(expression);
      if (expression.includes('scrollTo')) trace.scrolls.push(expression);
      if (expression.includes('dump')) return dumpJson;
      if (expression.includes('innerWidth')) return JSON.stringify([40, 40]);
      // rects() and paintProbeTargets() both want a JSON array; empty keeps the
      // pixel pass trivial (no crops, no probe round trips).
      if (expression.includes('rects') || expression.includes('ProbeTargets'))
        return '[]';
      return '';
    },
    screenshot: async () => tinyPng(),
    close: async () => {
      trace.closed = true;
    },
  };
  return { page, trace };
}

type LaunchOpts = { headless?: boolean } | undefined;
type FakeBrowser = {
  newPage: () => Promise<FakePage>;
  close: () => Promise<void>;
};
type FakeModule = {
  chromium: { launch: (o?: LaunchOpts) => Promise<FakeBrowser> };
};

// A fake `playwright` module whose chromium hands back a browser over `page`.
function fakePlaywright(page: FakePage): {
  module: FakeModule;
  launchCalls: LaunchOpts[];
} {
  const launchCalls: LaunchOpts[] = [];
  const browser: FakeBrowser = {
    newPage: async () => page,
    close: async () => {
      await page.close();
    },
  };
  const module: FakeModule = {
    chromium: {
      launch: async (o?: LaunchOpts) => {
        launchCalls.push(o);
        return browser;
      },
    },
  };
  return { module, launchCalls };
}

// ---------------------------------------------------------------------------
// Console + argv capture (restored after each test)
// ---------------------------------------------------------------------------

type Captured = { out: string[]; err: string[] };

function captureConsole(): { captured: Captured; restore: () => void } {
  const captured: Captured = { out: [], err: [] };
  const origLog = console.log;
  const origErr = console.error;
  // The CLI only ever logs single string arguments (USAGE, the JSON document,
  // the summary, the install hint, an error message), so a string sink is faithful.
  console.log = (message?: string) => {
    captured.out.push(String(message ?? ''));
  };
  console.error = (message?: string) => {
    captured.err.push(String(message ?? ''));
  };
  return {
    captured,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

const origArgv = process.argv;

afterEach(() => {
  process.argv = origArgv;
  // Bun does not clear `process.exitCode` on assignment of `undefined` once it
  // has been set to a number, so reset to 0 (its unset/healthy value) to keep a
  // prior usage/no-browser test from leaking a non-zero code into the next one.
  process.exitCode = 0;
  mock.restore();
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  test('takes the url from the first positional', () => {
    const a = parseArgs(['https://x.test']);
    expect(a.url).toBe('https://x.test');
    expect(a.full).toBe(false);
    expect(a.help).toBe(false);
  });

  test('ignores extra positionals (the page audits itself — no selectors)', () => {
    const a = parseArgs(['https://x.test', '#a,.b', 'extra']);
    expect(a.url).toBe('https://x.test');
  });

  test('sets the --full flag', () => {
    expect(parseArgs(['https://x.test', '--full']).full).toBe(true);
    expect(parseArgs(['https://x.test']).full).toBe(false);
  });

  test('accepts --full before the url', () => {
    const a = parseArgs(['--full', 'https://x.test']);
    expect(a.url).toBe('https://x.test');
    expect(a.full).toBe(true);
  });

  test('sets help via -h or --help', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['https://x.test', '--help']).help).toBe(true);
  });

  test('a `--flag=value` token splits on `=` (the flag, not the whole token)', () => {
    // Lenient: an unknown `--flag=value` is ignored, and `--full=anything`
    // still sets `full` (only the flag part before `=` is matched).
    expect(parseArgs(['https://x.test', '--full=yes']).full).toBe(true);
    expect(parseArgs(['https://x.test', '--unknown=1']).full).toBe(false);
  });

  test('an unknown flag is ignored (lenient)', () => {
    const a = parseArgs(['https://x.test', '--nope']);
    expect(a.url).toBe('https://x.test');
    expect(a.full).toBe(false);
    expect(a.help).toBe(false);
  });

  test('a missing url is undefined (the CLI prints usage)', () => {
    expect(parseArgs([]).url).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadPlaywright's import-failure branches, exercised through main().
//
// These MUST run before any test loads `playwright`: when a module is not yet
// in the registry, a `mock.module` factory that throws is invoked lazily at
// `await import(...)`, so the rejection lands inside loadPlaywright's try (the
// behaviour we want). Once `playwright` is loaded (the happy-path tests below
// do that), re-registering a throwing factory would throw eagerly instead — so
// this block stays first and never resolves a real/fake playwright.
// ---------------------------------------------------------------------------

describe('main: playwright import failures', () => {
  test('no-browser path: an absent playwright prints the install hint and exits 1', async () => {
    // A "cannot find module" rejection is how an absent optional dep surfaces;
    // loadPlaywright maps it to null so main() prints the install hint.
    mock.module('playwright', () => {
      throw new Error("Cannot find module 'playwright'");
    });

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/'];
    const { captured, restore } = captureConsole();
    try {
      await main();
    } finally {
      restore();
    }

    const err = captured.err.join('\n');
    expect(err).toContain('playwright is required');
    expect(err).toContain('bunx playwright install chromium');
    expect(captured.out).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  test('a non-missing-module import failure is re-thrown, not masked as "required"', async () => {
    // A broken/half-installed playwright (any other error) must surface, not
    // masquerade as "playwright is required".
    mock.module('playwright', () => {
      throw new Error('boom: half-installed playwright');
    });

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/'];
    const { captured, restore } = captureConsole();
    try {
      await expect(main()).rejects.toThrow('boom: half-installed playwright');
    } finally {
      restore();
    }
    // It threw before reaching the install-hint / output stages.
    expect(captured.out).toEqual([]);
    expect(captured.err.join('\n')).not.toContain('playwright is required');
  });
});

// ---------------------------------------------------------------------------
// main(): happy / --full / usage / help
// ---------------------------------------------------------------------------

describe('main', () => {
  test('happy path: launches, drives the session, prints compact JSON + summary', async () => {
    const { page, trace } = fakePage();
    const { module, launchCalls } = fakePlaywright(page);
    mock.module('playwright', () => module);

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/'];
    const { captured, restore } = captureConsole();
    try {
      await main();
    } finally {
      restore();
    }

    // Launched headless, navigated, and closed the browser in `finally`.
    expect(launchCalls).toEqual([{ headless: true }]);
    expect(trace.gotos).toEqual(['https://example.test/']);
    expect(trace.closed).toBe(true);
    // autoScroll ran (its scrollTo evaluates landed) before the keyframe loop.
    expect(trace.scrolls.length).toBeGreaterThan(0);
    expect(trace.scrolls.some((s) => s.includes('scrollHeight'))).toBe(true);
    // stdout is a single pretty-printed JSON document...
    expect(captured.out.length).toBe(1);
    const parsed: Report = JSON.parse(captured.out[0] ?? '');
    // compact output (default): has a numeric score; the faithful Report does not.
    expect(Reflect.has(parsed, 'score')).toBe(true);
    // ...and the health summary went to stderr, keeping stdout pure JSON.
    expect(captured.err.join('\n')).toContain('Visual health');
    // The happy path leaves the exit code unset (a clean run).
    expect(process.exitCode).toBeFalsy();
  });

  test('--full path: prints the faithful Report (no compact `score`)', async () => {
    const { page } = fakePage();
    const { module } = fakePlaywright(page);
    mock.module('playwright', () => module);

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/', '--full'];
    const { captured, restore } = captureConsole();
    try {
      await main();
    } finally {
      restore();
    }

    const parsed: Report = JSON.parse(captured.out[0] ?? '');
    // The faithful Report carries `session`/`elements` and no compact `score`.
    expect(Reflect.has(parsed, 'session')).toBe(true);
    expect(Reflect.has(parsed, 'score')).toBe(false);
    expect(parsed.elements[0]?.selector).toBe('#hero');
  });

  test('usage path: a missing url prints USAGE to stderr and exits 1', async () => {
    process.argv = ['bun', 'analyze-cli.ts'];
    const { captured, restore } = captureConsole();
    try {
      await main();
    } finally {
      restore();
    }
    expect(captured.err.join('\n')).toContain('usage: analyze <url>');
    expect(captured.out).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  test('help path: --help prints USAGE and exits 0', async () => {
    process.argv = ['bun', 'analyze-cli.ts', '--help'];
    const { captured, restore } = captureConsole();
    try {
      await main();
    } finally {
      restore();
    }
    expect(captured.err.join('\n')).toContain('usage: analyze <url>');
    expect(process.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// runCliEntry — the in-process entry wrapper (the `import.meta.main` guard runs
// it as the process entry; here we call it directly to cover both outcomes).
// ---------------------------------------------------------------------------

describe('runCliEntry', () => {
  test('runs main() to completion when it succeeds', async () => {
    const { page } = fakePage();
    const { module } = fakePlaywright(page);
    mock.module('playwright', () => module);

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/'];
    const { captured, restore } = captureConsole();
    try {
      await runCliEntry();
    } finally {
      restore();
    }
    expect(captured.out.length).toBe(1); // main ran and printed the report
    expect(process.exitCode).toBeFalsy();
  });

  test('reduces a thrown main() to a one-line error and exit 1', async () => {
    // A chromium.launch() that throws propagates out of main(); the wrapper's
    // catch surfaces the message and sets a non-zero exit code.
    mock.module('playwright', () => ({
      chromium: {
        launch: async () => {
          throw new Error('launch exploded');
        },
      },
    }));

    process.argv = ['bun', 'analyze-cli.ts', 'https://example.test/'];
    const { captured, restore } = captureConsole();
    try {
      await runCliEntry();
    } finally {
      restore();
    }
    expect(captured.err.join('\n')).toContain('launch exploded');
    expect(captured.out).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// autoScroll
// ---------------------------------------------------------------------------

describe('autoScroll', () => {
  test('steps through six fractions of the page then returns to the top', async () => {
    const scrolls: string[] = [];
    let waits = 0;
    const page: PageLike = {
      addInitScript: async () => {},
      goto: async () => {},
      waitForTimeout: async () => {
        waits++;
      },
      evaluate: async (expression) => {
        scrolls.push(expression);
        return '';
      },
    };

    await autoScroll(page);

    // Six stepped scrolls (each waited on) + one final scroll back to the top.
    expect(scrolls.length).toBe(7);
    expect(waits).toBe(6);
    expect(scrolls.filter((s) => s.includes('scrollHeight')).length).toBe(6);
    // The last call parks the page at the origin so the report's start box is stable.
    expect(scrolls[6]).toBe('window.scrollTo(0, 0)');
    // The first step targets 1/6 of the page height.
    expect(scrolls[0]).toContain(`* ${1 / 6}`);
  });
});

// ---------------------------------------------------------------------------
// renderSummary
// ---------------------------------------------------------------------------

// A settled-box helper so report elements satisfy the type without ceremony.
function reportElement(
  over: Partial<ReportElement> & { selector: string },
): ReportElement {
  const box = rect(0, 10, 10, 0);
  return {
    testid: over.testid ?? null,
    selector: over.selector,
    label: over.label ?? over.selector,
    source: over.source ?? 'matched',
    impactMode: over.impactMode ?? ['paints'],
    anchoredTo: over.anchoredTo ?? null,
    anchoredEdges: over.anchoredEdges ?? [],
    bounds: over.bounds ?? {
      screen: { start: box, end: box },
      page: { start: box, end: box },
    },
  };
}

function defect(over: Partial<Defect> & { selector: string }): Defect {
  return {
    id: over.id ?? `${over.selector}-d`,
    type: over.type ?? 'flicker',
    testid: over.testid ?? null,
    selector: over.selector,
    segment: over.segment ?? 0,
    severity: over.severity ?? 0.5,
    window: over.window ?? [0, 100],
    metrics: over.metrics ?? {},
    detail: over.detail ?? 'toggled visibility',
  };
}

const SEGMENT: Segment = {
  index: 0,
  url: 'https://example.test/',
  from: 0,
  to: 1000,
};

function buildReportLiteral(over: {
  elements?: readonly ReportElement[];
  defects?: readonly Defect[];
  audit?: Report['session']['audit'];
}): Report {
  return {
    session: {
      segments: [SEGMENT],
      pixelThreshold: 1,
      frameBudgetMs: 1000 / 60,
      ...(over.audit ? { audit: over.audit } : {}),
    },
    elements: over.elements ?? [],
    transitions: [],
    defects: over.defects ?? [],
  };
}

// The worst-defect lines are indented (two leading spaces) and start with a
// `[severity]` bracket; the headline also names the defect type, so match the
// bracketed worst line specifically rather than the first `flicker` mention.
function worstLineFor(text: string, type: string): string | undefined {
  return text.split('\n').find((l) => l.startsWith('  [') && l.includes(type));
}

describe('renderSummary', () => {
  test('a clean report is just the headline (no audit, worst, or hints lines)', () => {
    const report = buildReportLiteral({
      elements: [reportElement({ selector: '#hero' })],
    });
    const text = renderSummary(report);
    expect(text).toBe(renderSummary(report)); // deterministic
    expect(text).toContain('Visual health');
    expect(text).toContain('no defects');
    expect(text).not.toContain('worst:');
    expect(text).not.toContain('hints:');
    expect(text).not.toContain('page audit:');
  });

  test('prefers the element label over the bare selector and counts repeats', () => {
    // Two flicker defects on the same selector coalesce into one `×2` line, and
    // the element's role+name label is shown instead of the raw selector.
    const report = buildReportLiteral({
      elements: [reportElement({ selector: '#bar', label: 'button "Buy"' })],
      defects: [
        defect({ selector: '#bar', severity: 0.8, detail: 'rapid toggle' }),
        defect({ selector: '#bar', severity: 0.4, detail: 'rapid toggle' }),
      ],
    });
    const text = renderSummary(report);
    expect(text).toContain('worst:');
    const worstLine = worstLineFor(text, 'flicker');
    expect(worstLine).toBeDefined();
    // Worst severity (0.80), the ×2 repeat count, the label, and the detail.
    expect(worstLine).toContain('[0.80 ×2]');
    expect(worstLine).toContain('button "Buy"');
    expect(worstLine).toContain('rapid toggle');
    // A defect type present yields its remediation hint.
    expect(text).toContain('hints:');
  });

  test('falls back to the raw selector when no element matches the defect', () => {
    // A single (count 1) defect on a selector absent from `elements` shows the
    // selector and omits the `×N` suffix.
    const report = buildReportLiteral({
      defects: [defect({ selector: '#ghost', severity: 0.3 })],
    });
    const text = renderSummary(report);
    const worstLine = worstLineFor(text, 'flicker');
    expect(worstLine).toContain('#ghost');
    expect(worstLine).not.toContain('×');
  });

  test('reports audit metadata: uncapped count', () => {
    const report = buildReportLiteral({
      elements: [reportElement({ selector: '#hero' })],
      audit: { wholePage: true, discovered: 7, capped: false },
    });
    expect(renderSummary(report)).toContain('page audit: 7 elements');
  });

  test('reports audit metadata: a capped count flags untracked elements', () => {
    const report = buildReportLiteral({
      audit: { wholePage: true, discovered: 30, capped: true },
    });
    expect(renderSummary(report)).toContain(
      'page audit: 30 elements (capped — some not tracked)',
    );
  });
});

// ---------------------------------------------------------------------------
// The `import.meta.main` entry wrapper — only true when the file is the process
// entry, so it is exercised out-of-process. These assert the wrapped main()'s
// observable contract end to end (usage path + the catch that turns a thrown
// browser-launch failure into a one-line error and a non-zero exit code).
// ---------------------------------------------------------------------------

const CLI = new URL('./analyze-cli.ts', import.meta.url).pathname;

async function runCli(
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe('CLI entry (import.meta.main)', () => {
  test('no url: prints usage and exits 1', async () => {
    const { code, stdout, stderr } = await runCli([]);
    expect(code).toBe(1);
    expect(stderr).toContain('usage: analyze <url>');
    expect(stdout).toBe('');
  });

  test('--help: prints usage and exits 0', async () => {
    const { code, stderr } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stderr).toContain('usage: analyze <url>');
  });

  test('a browser-launch failure is caught as a one-line error and exits 1', async () => {
    // Point playwright at an empty browser root so `chromium.launch()` throws;
    // the entry wrapper's catch must surface that message and set exit code 1.
    const empty = `${process.cwd()}/.tmp-no-browsers-${Date.now()}`;
    const { code, stdout, stderr } = await runCli(['https://example.test/'], {
      PLAYWRIGHT_BROWSERS_PATH: empty,
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    // The thrown launch error reduced to a one-line message (no JSON emitted).
    expect(stderr).toContain("Executable doesn't exist");
  });
});
