/**
 * Docs screenshot capture runner. Every committed docs image is produced by
 * this script from the declarative manifest (`manifest.ts`) — no hand-captured
 * screenshot ever ships (builtin-configs/skills/write-docs/SCREENSHOTS.md).
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
 * seeded entity ids) persists in `.state/` between runs; delete the dir to
 * mint a fresh workspace.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  chromium,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { createOrgViaWizard } from '../e2e/helpers/auth';
import { BASE_URL, TIMEOUT } from '../e2e/helpers/env';
import { DEMO_ORG_NAME, DEMO_OWNER } from './demo-content';
import { SHOTS, type Shot, type ShotContext } from './manifest';
import { seedDemoOrg } from './seed-demo-org';
import { encodeWebp } from './webp';

const MOCK_GATEWAY_URL =
  process.env.TALE_MOCK_CONNECTORS_BASE ?? 'http://127.0.0.1:4141';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../..');
const IMAGES_ROOT = path.join(REPO_ROOT, 'services/docs/public/images');
const MANIFEST_JSON = path.join(IMAGES_ROOT, 'manifest.json');
const STATE_DIR = path.join(HERE, '.state');
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
}

interface CliArgs {
  list: boolean;
  skipSeed: boolean;
  only: string[];
  grep: RegExp | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { list: false, skipSeed: false, only: [], grep: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') args.list = true;
    else if (arg === '--skip-seed') args.skipSeed = true;
    else if (arg === '--only') args.only.push(...(argv[++i] ?? '').split(','));
    else if (arg === '--grep') args.grep = new RegExp(argv[++i] ?? '');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function selectShots(args: CliArgs): readonly Shot[] {
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
          `Bring up the Mode-A stack first (two terminals, from services/platform):\n` +
          `  1) bun lib/mocks/start.ts\n` +
          `  2) TALE_DEV_SKIP_DOCKER=1 TALE_DEV_OPEN=0 \\\n` +
          `     TALE_CONFIG_DIR="$(pwd)/tests/e2e/fixtures/config" \\\n` +
          `     TALE_CONFIG_BUILTIN_DIR="$(pwd)/tests/e2e/fixtures/config/docs-demo" \\\n` +
          `     TALE_PROVIDER_KEY_E2E_MOCK=tale-e2e-mock-key \\\n` +
          `     TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 \\\n` +
          `     TALE_MOCK_CONNECTORS_BASE=http://127.0.0.1:4141 \\\n` +
          `     bun scripts/dev.ts\n\n` +
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

/** In-page sign-up/sign-in: Playwright's APIRequestContext crashes parsing
 *  Set-Cookie under Bun, so authenticate with the browser's own fetch (same
 *  pattern as tests/manual/scripts/save-auth-state.ts). */
async function signUpOrIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto('/log-in');
  const attempt = (endpoint: string) =>
    page.evaluate(
      async ({ url, owner }) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: owner.name,
            email: owner.email,
            password: owner.password,
          }),
        });
        return { status: res.status, body: await res.text() };
      },
      { url: endpoint, owner: DEMO_OWNER },
    );
  const signUp = await attempt('/api/auth/sign-up/email');
  if (signUp.status >= 400) {
    // The demo account persists across .state resets — fall back to sign-in.
    const signIn = await attempt('/api/auth/sign-in/email');
    if (signIn.status >= 400) {
      throw new Error(
        `Could not authenticate ${DEMO_OWNER.email}: sign-up ${signUp.status} (${signUp.body.slice(0, 200)}), ` +
          `sign-in ${signIn.status} (${signIn.body.slice(0, 200)})`,
      );
    }
  }
  await page.close();
}

/**
 * Block until the demo org has finished scaffolding. The e2e helper's
 * waitForSeededOrg waits for the E2E fixture agent, which this stack never
 * seeds. The "scaffold complete" marker is the seeded automation packs on the
 * Automations page — provisioning writes them at org creation, so a listed
 * pack row means the org's catalog scaffold ran. Reload-and-retry so a page
 * that loaded before provisioning finished gets a fresh read.
 */
async function waitForDemoScaffold(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/automations`);
  const packRow = page.getByText('gmail-triage-inbox', { exact: true }).first();
  const ATTEMPTS = 8;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
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
      await page.reload();
    }
  }
}

async function bootstrap(
  browser: Browser,
  skipSeed: boolean,
): Promise<OrgState> {
  const cached = readOrgState();
  if (cached) {
    console.log(
      `Reusing demo org ${cached.orgId} (${cached.email}) from .state/`,
    );
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
    const ids = await seedDemoOrg(page, state.orgId);
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
): Promise<void> {
  const captured: ManifestEntry[] = [];
  // One shot's failure must not cost the other 49: capture what it can,
  // upsert the manifest for what succeeded, and exit red with the list of
  // failures at the end (a shot whose surface needs an absent backend —
  // e.g. RAG "Indexed" badges without the knowledge DB — fails alone).
  const failures: { name: string; reason: string }[] = [];
  {
    for (const shot of shots) {
      const viewport = shot.viewport ?? VIEWPORT;
      const context = await browser.newContext({
        baseURL: BASE_URL,
        storageState: AUTH_STATE,
        viewport,
        deviceScaleFactor: DPR,
        colorScheme: 'light',
        locale: 'en-US',
        timezoneId: 'UTC',
        // No service worker: kills the "ready to work offline" toast that
        // otherwise photobombs the first capture after a fresh context, and
        // takes stale-cache flakiness out of the shots entirely.
        serviceWorkers: 'block',
        // chat-shared-view reads the share URL Share put on the clipboard.
        permissions: ['clipboard-read', 'clipboard-write'],
      });
      try {
        // Deterministic theme + locale regardless of saved preferences.
        await context.addInitScript(() => {
          window.localStorage.setItem('tale-theme', 'light');
          window.localStorage.setItem('user-locale', 'en');
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
        });
        const page = await context.newPage();
        await page.emulateMedia({ reducedMotion: 'reduce' });

        const route = shot.route.replace(':orgId', ctx.orgId);
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await shot.prepare?.(page, ctx);
        await expect(shot.readyWhen(page, ctx)).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        await shot.sanitize?.(page, ctx);

        const target = shot.capture?.(page, ctx);
        const png = target
          ? await target.screenshot({ animations: 'disabled' })
          : await page.screenshot({ animations: 'disabled' });
        const encoded = await encodeWebp(png, shot.name);

        const relFile = path.join('images', shot.section, `${shot.name}.webp`);
        const outPath = path.join(
          IMAGES_ROOT,
          shot.section,
          `${shot.name}.webp`,
        );
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
        });
        console.log(
          `✓ ${shot.name} → ${relFile} (${Math.round(encoded.bytes.byteLength / 1024)} KB, q${encoded.quality}, ${encoded.width}×${encoded.height})`,
        );
      } catch (err) {
        const reason =
          err instanceof Error ? err.message.split('\n')[0] : String(err);
        failures.push({ name: shot.name, reason });
        console.error(`✗ ${shot.name} — ${reason}`);
      } finally {
        await context.close();
      }
    }
  }
  upsertManifest(captured);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length}/${shots.length} shots failed:\n` +
        failures.map((f) => `  ✗ ${f.name} — ${f.reason}`).join('\n'),
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
    await captureShots(browser, shots, toContext(state));
  } finally {
    await browser.close();
  }
  console.log(`Done: ${shots.length} shot(s). Manifest: ${MANIFEST_JSON}`);
}

main().catch((error) => {
  console.error('docs:screenshots failed:', error);
  process.exit(1);
});
