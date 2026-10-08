/**
 * Docs screenshot capture runner. Every committed docs image is produced by
 * this script from the declarative manifest (`manifest.ts`) — no hand-captured
 * screenshot ever ships (.agents/skills/write-docs/SCREENSHOTS.md).
 *
 *   bun run docs:screenshots                 # bootstrap + seed + all shots
 *   bun run docs:screenshots -- --list       # enumerate shots
 *   bun run docs:screenshots -- --only chat-composer
 *   bun run docs:screenshots -- --grep '^chat-'
 *   bun run docs:screenshots -- --skip-seed  # reuse the persisted org as-is
 *
 * The runner never boots the stack — it preflights the mock gateway (:4141)
 * and the app (:3000) and exits with the bring-up commands when either is
 * down (see README.md, the runbook). Bootstrap state (auth cookies, org id,
 * seeded entity ids) persists between runs. Use --state-dir or
 * TALE_SCREENSHOT_STATE_DIR for an isolated workspace; keep existing state.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, expect, type Browser, type Page } from '@playwright/test';

import { createOrgViaWizard } from '../e2e/helpers/auth';
import { BASE_URL, TIMEOUT } from '../e2e/helpers/env';
import { signUpOrIn } from './capture-auth';
import {
  parseCaptureArgs,
  screenshotFile,
  screenshotStateDir,
  type CaptureArgs,
  type CaptureLocale,
} from './capture-options';
import { DEMO_ORG_NAME, DEMO_OWNER } from './demo-content';
import { withCaptureLocale } from './i18n';
import { SHOTS, type Shot, type ShotContext } from './manifest';
import { seedDemoOrg } from './seed-demo-org';
import { encodeWebp } from './webp';

const MOCK_GATEWAY_URL =
  process.env.TALE_MOCK_CONNECTORS_BASE ?? 'http://127.0.0.1:4141';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../..');
const IMAGES_ROOT = path.join(REPO_ROOT, 'services/docs/public/images');
const MANIFEST_JSON = path.join(IMAGES_ROOT, 'manifest.json');
const ARGS = parseCaptureArgs(process.argv.slice(2));
const STATE_DIR = screenshotStateDir(
  ARGS,
  process.env.TALE_SCREENSHOT_STATE_DIR,
  path.join(HERE, '.state'),
);
const AUTH_STATE = path.join(STATE_DIR, 'auth.json');
const ORG_STATE = path.join(STATE_DIR, 'org.json');

const VIEWPORT = { width: 1440, height: 900 } as const;
const DPR = 2;

interface OrgState {
  orgId: string;
  email: string;
  threads: Record<string, string>;
  projects: Record<string, string>;
}

interface ManifestEntry {
  file: string;
  shot: string;
  route: string;
  viewport: { width: number; height: number };
  dpr: number;
  width: number;
  height: number;
  locale: CaptureLocale;
}
function selectShots(args: CaptureArgs): readonly Shot[] {
  let shots: readonly Shot[] = SHOTS;
  if (args.only.length > 0) {
    const names = new Set(args.only.filter(Boolean));
    shots = shots.filter((shot) => names.has(shot.name));
    const missing = [...names].filter(
      (name) => !SHOTS.some((shot) => shot.name === name),
    );
    if (missing.length > 0) {
      throw new Error(`Unknown shot name(s): ${missing.join(', ')}`);
    }
  }
  if (args.grep) shots = shots.filter((shot) => args.grep?.test(shot.name));
  return shots;
}

async function preflight(): Promise<void> {
  const checks: Array<[string, string]> = [
    [`${MOCK_GATEWAY_URL}/health`, 'mock gateway'],
    [BASE_URL, 'platform app'],
  ];
  for (const [url, label] of checks) {
    try {
      const res = await fetch(url);
      if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error(
        `Preflight failed: the ${label} is not reachable at ${url} (${String(error)}).\n\n` +
          `Start the mock gateway and platform with the database and object store available.\n` +
          `See tests/docs-screenshots/README.md for the full runbook.`,
      );
      process.exit(1);
    }
  }
}

function readOrgState(): OrgState | null {
  if (!existsSync(AUTH_STATE) || !existsSync(ORG_STATE)) return null;
  try {
    return JSON.parse(readFileSync(ORG_STATE, 'utf8')) as OrgState;
  } catch (error) {
    console.warn('Discarding unreadable org state:', error);
    return null;
  }
}

/**
 * Block until the demo org has finished scaffolding. The e2e helper's
 * waitForSeededOrg waits for the E2E fixture agent, which this stack never
 * seeds. The "scaffold complete" marker is the seeded automation packs on the
 * Automations page — provisioning writes them at org creation, so a listed
 * pack row means the org's catalog scaffold ran. Navigate-and-retry so a page
 * that loaded before provisioning finished gets a fresh read.
 */
async function waitForDemoScaffold(
  page: Page,
  organizationId: string,
): Promise<void> {
  const packRow = page.getByText('gmail-triage-inbox', { exact: true }).first();
  const ATTEMPTS = 8;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // The navigation belongs INSIDE the retry: a cold Vite re-optimizes
      // dependencies on the first visits and reloads the page mid-load, which
      // surfaces as net::ERR_ABORTED on the goto itself.
      await page.goto(`/dashboard/${organizationId}/automations`);
      await expect(packRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      return;
    } catch (err) {
      if (attempt === ATTEMPTS) {
        throw new Error(
          `The seeded automation packs never appeared for org ${organizationId} at ${BASE_URL}. ` +
            `The stack must run with TALE_CONFIG_BUILTIN_DIR pointing at tests/e2e/fixtures/config/docs-demo ` +
            `(see tests/docs-screenshots/README.md).`,
          { cause: err },
        );
      }
    }
  }
}

/**
 * The persisted session dies while `.state/` lives on — the deployment's idle
 * timeout signs the demo owner out between runs, and a backend restarted with
 * another secret rejects the cookie outright. Probe it before reusing the
 * state and sign back in when it is gone; otherwise every stage that follows
 * meets the login screen and fails on a locator that was never the problem.
 */
async function ensureSignedIn(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: AUTH_STATE,
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    await page.goto('/log-in');
    const status = await page.evaluate(
      async () => (await fetch('/api/app/users/me')).status,
    );
    if (status === 200) return;
    console.log(
      `Stored session rejected (HTTP ${status}) — signing ${DEMO_OWNER.email} back in.`,
    );
    await signUpOrIn(context);
    await context.storageState({ path: AUTH_STATE });
  } finally {
    await context.close();
  }
}

async function bootstrap(
  browser: Browser,
  skipSeed: boolean,
): Promise<OrgState> {
  const cached = readOrgState();
  if (cached) {
    console.log(
      `Reusing demo org ${cached.orgId} (${cached.email}) from ${STATE_DIR}`,
    );
    await ensureSignedIn(browser);
    return cached;
  }

  console.log('Bootstrapping the demo workspace…');
  const context = await browser.newContext({
    baseURL: BASE_URL,
    serviceWorkers: 'block',
  });
  try {
    await signUpOrIn(context);
    const page = await context.newPage();
    const orgId = await createOrgViaWizard(page, { orgName: DEMO_ORG_NAME });
    await waitForDemoScaffold(page, orgId);

    mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: AUTH_STATE });
    const state: OrgState = {
      orgId,
      email: DEMO_OWNER.email,
      threads: {},
      projects: {},
    };
    writeFileSync(ORG_STATE, JSON.stringify(state, null, 2));
    if (skipSeed) {
      console.warn(
        'Fresh org with --skip-seed: shots needing seeds will fail.',
      );
    }
    return state;
  } finally {
    await context.close();
  }
}

async function seed(browser: Browser, state: OrgState): Promise<OrgState> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: AUTH_STATE,
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  try {
    const page = await context.newPage();
    const ids = await seedDemoOrg(page, state.orgId, {
      configDir: ARGS.configDir ?? undefined,
    });
    const next: OrgState = {
      ...state,
      threads: Object.fromEntries(ids.threads),
      projects: Object.fromEntries(ids.projects),
    };
    writeFileSync(ORG_STATE, JSON.stringify(next, null, 2));
    return next;
  } finally {
    await context.close();
  }
}

function toContext(state: OrgState): ShotContext {
  return {
    orgId: state.orgId,
    threads: new Map(Object.entries(state.threads)),
    projects: new Map(Object.entries(state.projects)),
  };
}

function upsertManifest(entries: ManifestEntry[]): void {
  let existing: ManifestEntry[] = [];
  if (existsSync(MANIFEST_JSON)) {
    try {
      existing = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'))
        .entries as ManifestEntry[];
    } catch (error) {
      console.warn('Rewriting unreadable images manifest:', error);
    }
  }
  const byFile = new Map(existing.map((entry) => [entry.file, entry]));
  for (const entry of entries) byFile.set(entry.file, entry);
  // Prune entries whose image no longer exists (renamed/removed shots).
  const kept = [...byFile.values()]
    .filter((entry) => existsSync(path.join(IMAGES_ROOT, '..', entry.file)))
    .sort((a, b) => a.file.localeCompare(b.file));
  mkdirSync(IMAGES_ROOT, { recursive: true });
  writeFileSync(
    MANIFEST_JSON,
    `${JSON.stringify({ entries: kept }, null, 2)}\n`,
  );
}

async function captureShots(
  browser: Browser,
  shots: readonly Shot[],
  ctx: ShotContext,
  locales: readonly CaptureLocale[],
): Promise<void> {
  const captured: ManifestEntry[] = [];
  // One shot's failure must not cost the other 49: capture what it can,
  // upsert the manifest for what succeeded, and exit red with the list of
  // failures at the end (a shot whose surface needs an absent backend —
  // e.g. RAG "Indexed" badges without the knowledge DB — fails alone).
  const failures: { name: string; reason: string }[] = [];
  for (const locale of locales) {
    await withCaptureLocale(locale, async () => {
      for (const shot of shots) {
        const viewport = shot.viewport ?? VIEWPORT;
        const context = await browser.newContext({
          baseURL: BASE_URL,
          storageState: AUTH_STATE,
          viewport,
          deviceScaleFactor: DPR,
          colorScheme: 'light',
          locale:
            locale === 'en' ? 'en-US' : locale === 'de' ? 'de-DE' : 'fr-FR',
          timezoneId: 'UTC',
          // No service worker: kills the "ready to work offline" toast that
          // otherwise photobombs the first capture after a fresh context, and
          // takes stale-cache flakiness out of the shots entirely.
          serviceWorkers: 'block',
          // chat-shared-view reads the share URL Share put on the clipboard.
          permissions: ['clipboard-read', 'clipboard-write'],
        });
        let page: Page | undefined;
        try {
          // Deterministic theme + locale regardless of saved preferences.
          await context.addInitScript((captureLocale) => {
            window.localStorage.setItem('tale-theme', 'light');
            window.localStorage.setItem('user-locale', captureLocale);
            // No toasts in docs shots, ever — and the dev stack's "Update
            // available" banner floats over the header where its Close button
            // intercepts prepare() clicks (share menu, arena toggle). Hiding
            // the whole toast viewport is deliberate: a screenshot pipeline
            // has no toast worth photographing.
            document.addEventListener('DOMContentLoaded', () => {
              const style = document.createElement('style');
              style.textContent =
                '[role="region"][aria-label^="Notifications"] { display: none !important; }';
              document.head.append(style);
            });
          }, locale);
          page = await context.newPage();
          await page.emulateMedia({ reducedMotion: 'reduce' });

          const route = shot.route.replace(':orgId', ctx.orgId);
          await page.goto(route, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('html')).toHaveAttribute('lang', locale, {
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await shot.prepare?.(page, ctx);
          await expect(page.locator('html')).toHaveAttribute('lang', locale, {
            timeout: TIMEOUT.FIRST_PAINT,
          });
          await expect(shot.readyWhen(page, ctx)).toBeVisible({
            timeout: TIMEOUT.FIRST_PAINT,
          });
          if (shot.localizedReadyWhen) {
            await expect(shot.localizedReadyWhen(page, ctx)).toBeVisible({
              timeout: TIMEOUT.FIRST_PAINT,
            });
          }
          await shot.sanitize?.(page, ctx);

          const target = shot.capture?.(page, ctx);
          const png = target
            ? await target.screenshot({ animations: 'disabled' })
            : await page.screenshot({ animations: 'disabled' });
          const encoded = await encodeWebp(png, shot.name);

          const relFile = screenshotFile(shot.section, shot.name, locale);
          const outPath = path.join(IMAGES_ROOT, '..', relFile);
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, encoded.bytes);
          captured.push({
            file: relFile,
            shot: shot.name,
            route: shot.route,
            viewport,
            dpr: DPR,
            width: encoded.width,
            height: encoded.height,
            locale,
          });
          console.log(
            `✓ ${shot.name} [${locale}] → ${relFile} (${Math.round(encoded.bytes.byteLength / 1024)} KB, q${encoded.quality}, ${encoded.width}×${encoded.height})`,
          );
        } catch (err) {
          const reason =
            err instanceof Error ? err.message.split('\n')[0] : String(err);
          failures.push({ name: `${shot.name} [${locale}]`, reason });
          console.error(`✗ ${shot.name} [${locale}] — ${reason}`);
        } finally {
          if (shot.restore && page) {
            try {
              await shot.restore(page, ctx);
            } catch (err) {
              // A failed restore leaves org state behind that later shots can
              // photograph — surface it as this shot's failure.
              const reason =
                err instanceof Error ? err.message.split('\n')[0] : String(err);
              failures.push({
                name: `${shot.name} [${locale}]`,
                reason: `restore: ${reason}`,
              });
              console.error(`✗ ${shot.name} [${locale}] restore — ${reason}`);
            }
          }
          await context.close();
        }
      }
    });
  }
  upsertManifest(captured);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length}/${shots.length * locales.length} shots failed:\n` +
        failures.map((f) => `  ✗ ${f.name} — ${f.reason}`).join('\n'),
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = ARGS;
  const shots = selectShots(args);
  if (args.list) {
    for (const shot of shots) {
      console.log(`${shot.name}  [${shot.section}]  ${shot.route}`);
    }
    return;
  }
  if (shots.length === 0) {
    console.error('No shots matched the selection.');
    process.exit(1);
  }

  await preflight();
  // One browser for the whole run: repeated chromium.launch() calls in a
  // single Bun process intermittently die at the DevTools pipe.
  const browser = await chromium.launch();
  try {
    let state = await bootstrap(browser, args.skipSeed);
    if (!args.skipSeed) state = await seed(browser, state);
    await captureShots(browser, shots, toContext(state), args.locales);
  } finally {
    await browser.close();
  }
  console.log(
    `Done: ${shots.length * args.locales.length} shot(s). Manifest: ${MANIFEST_JSON}`,
  );
}

main().catch((error) => {
  console.error('docs:screenshots failed:', error);
  process.exit(1);
});
