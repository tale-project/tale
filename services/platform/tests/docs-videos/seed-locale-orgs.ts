/**
 * Bootstrap + seed the VIDEO locale demo orgs (de, fr).
 *
 *   bun services/platform/tests/docs-videos/seed-locale-orgs.ts             # both
 *   bun services/platform/tests/docs-videos/seed-locale-orgs.ts --locale de
 *
 * The English take records against the shared docs-screenshots org; German
 * and French record against their own orgs so every piece of CONTENT the
 * camera sees (task titles, documents, knowledge entries) is native. Same
 * demo owner account owns all three; requires the docs-screenshots `.state/`
 * bootstrap (run `bun run docs:screenshots` first) and the Mode-A stack.
 *
 * Idempotent end to end: existing orgs are reused, the subset seeder is
 * check-then-create, the triage install is skipped when present, and the
 * staged trigger tasks are check-then-create per title (an org seeded from
 * an older content draft gains the missing ones on re-run). State lands in
 * `.state/locale-orgs.json` for the recorder.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';

import { seedVideoLocaleOrg } from '../docs-screenshots/seed-demo-org';
import { BASE_URL, TIMEOUT } from '../e2e/helpers/env';
import { t } from '../e2e/helpers/i18n';
import type { Locale } from './lib/episode';
import { videoContentFor } from './lib/locale-content';
import { SCREENSHOTS_STATE_DIR, STATE_DIR } from './lib/paths';

const LOCALE_ORGS = path.join(STATE_DIR, 'locale-orgs.json');
const SCREENSHOTS_AUTH = path.join(SCREENSHOTS_STATE_DIR, 'auth.json');
const TRIAGE_PATH = 'projects__tasks__triage-unassigned';

/** The org names are workspace fiction — native per locale, and distinct so
 * the create-org wizard never collides on a slug. */
const ORG_NAMES: Record<Exclude<Locale, 'en'>, string> = {
  de: 'Nordlicht Labs',
  // ASCII on purpose: the create-org wizard's name validation rejected
  // "Boréale Labs" (Next never enabled) — worth a product issue; the org
  // name is never on camera anyway.
  fr: 'Aurore Labs',
};

interface LocaleOrgState {
  orgId: string;
  projects: Record<string, string>;
}
type LocaleOrgsFile = Partial<Record<Exclude<Locale, 'en'>, LocaleOrgState>>;

function readState(): LocaleOrgsFile {
  if (!existsSync(LOCALE_ORGS)) return {};
  try {
    return JSON.parse(readFileSync(LOCALE_ORGS, 'utf8')) as LocaleOrgsFile;
  } catch (error) {
    console.warn('Discarding unreadable locale-orgs state:', error);
    return {};
  }
}

/**
 * Create an ADDITIONAL org on the demo owner account. The e2e
 * createOrgViaWizard helper gotos /dashboard, which resolves straight into
 * the account's existing org — the wizard route must be hit directly.
 */
async function createAdditionalOrg(
  page: Page,
  orgName: string,
): Promise<string> {
  await page.goto('/dashboard/create-organization', {
    waitUntil: 'domcontentloaded',
  });
  const nameInput = page.getByLabel(
    t('settings.organization.organizationName'),
  );
  const nextButton = page.getByRole('button', {
    name: t('common.actions.next'),
    exact: true,
  });
  await nameInput.waitFor({ state: 'visible', timeout: TIMEOUT.FIRST_PAINT });
  // Controlled input: a fill that races hydration leaves the field empty and
  // Next disabled forever. Fill until the value sticks AND Next enables.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await nameInput.fill(orgName);
    const stuck = (await nameInput.inputValue()) === orgName;
    const enabled = stuck
      ? await nextButton.isEnabled().catch(() => false)
      : false;
    if (stuck && enabled) break;
    if (attempt === 5) {
      throw new Error(
        `Org wizard never accepted the name "${orgName}" (Next stayed disabled).`,
      );
    }
    await page.waitForTimeout(700);
  }
  await nextButton.click();
  // Two-step wizard (workspace then finish) — the old provider/Skip step is
  // gone; wait generously for org-create before the finish step paints.
  const finishButton = page.getByRole('button', {
    name: t('onboarding.finish.goToDashboard'),
    exact: true,
  });
  await finishButton.waitFor({ state: 'visible', timeout: TIMEOUT.EXECUTION });
  await finishButton.click();
  await page.waitForURL(/\/dashboard\/[a-z0-9]{20,}/, {
    timeout: TIMEOUT.NAV,
  });
  const orgId = /\/dashboard\/([a-z0-9]{20,})/.exec(page.url())?.[1];
  if (!orgId) {
    throw new Error(`No org id in URL after creating "${orgName}"`);
  }
  return orgId;
}

async function waitForScaffold(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/agents`);
  const folderRow = page.getByRole('row', { name: 'Chat' }).first();
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await folderRow.waitFor({ state: 'visible', timeout: TIMEOUT.VISIBLE });
      return;
    } catch (error) {
      if (attempt === 8) {
        throw new Error(`Org ${orgId} never scaffolded its agent catalog`, {
          cause: error,
        });
      }
      await page.reload();
    }
  }
}

async function ensureTriageStaged(
  page: Page,
  orgId: string,
  relaunchProjectId: string,
  staged: { green: string; red: string; suggested: string },
): Promise<void> {
  // 1. Installed?
  await page.goto(`/dashboard/${orgId}/automations/${TRIAGE_PATH}`, {
    waitUntil: 'domcontentloaded',
  });
  const install = page.getByRole('button', { name: 'Install', exact: true });
  const executionsLink = page.locator(
    `main a[href*="${TRIAGE_PATH}?tab=executions"]`,
  );
  const installed = await executionsLink
    .first()
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!installed) {
    await install.waitFor({ state: 'visible', timeout: 15_000 });
    await install.click();
    await executionsLink.first().waitFor({ state: 'visible', timeout: 20_000 });
    console.log('  · triage automation installed');
  }

  // 2. Ensure BOTH trigger tasks exist — checked per title, so an org seeded
  //    from an older content draft gains the missing ones (existing runs are
  //    no proof: they may have fired for retired titles). Task CREATION
  //    fires the runs (one green, one deliberately red; DOCS_TRIAGE_SCORES
  //    carries both titles).
  await page.goto(
    `/dashboard/${orgId}/projects/${relaunchProjectId}/tasks/board`,
    { waitUntil: 'domcontentloaded' },
  );
  const newTaskButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await newTaskButton.waitFor({ state: 'visible', timeout: 20_000 });
  for (const title of [staged.green, staged.red, staged.suggested]) {
    if (
      await page
        .getByText(title, { exact: true })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      continue;
    }
    await newTaskButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('tasks.actions.create'),
    });
    await dialog.waitFor({ state: 'visible', timeout: 15_000 });
    await dialog
      .getByRole('textbox', { name: t('tasks.fields.title') })
      .fill(title);
    await dialog
      .getByRole('button', { name: t('tasks.actions.create'), exact: true })
      .click();
    await page
      .getByText(title, { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`  · staged trigger task "${title}"`);
  }

  // 3. Wait for both runs to land. Each attempt WAITS for the rows (a bare
  //    isVisible() right after reload loses to the query paint on a loaded
  //    machine and the loop reloads the page out from under itself); the
  //    reload between attempts refetches the log until the queue catches up
  //    — under load the runs have taken 2-3 minutes.
  await page.goto(
    `/dashboard/${orgId}/automations/${TRIAGE_PATH}?tab=executions`,
    { waitUntil: 'domcontentloaded' },
  );
  for (let attempt = 1; attempt <= 20; attempt++) {
    const completedVisible = await page
      .getByText(t('common.status.completed'))
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    const failedVisible =
      completedVisible &&
      (await page
        .getByText(t('common.status.failed'))
        .first()
        .waitFor({ state: 'visible', timeout: 4_000 })
        .then(() => true)
        .catch(() => false));
    if (completedVisible && failedVisible) {
      console.log('  · triage runs staged (one green, one red)');
      return;
    }
    await page.reload();
  }
  throw new Error('Triage runs never appeared in the executions log');
}

async function ensureLocaleOrg(
  browser: Browser,
  locale: Exclude<Locale, 'en'>,
): Promise<LocaleOrgState> {
  const state = readState();
  const content = videoContentFor(locale);

  // Seeding drives the ENGLISH UI (the shared seeder's locators are pinned to
  // the en catalog); the CONTENT it types is native to the locale.
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: SCREENSHOTS_AUTH,
    viewport: { width: 1600, height: 1000 },
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  try {
    await context.addInitScript(() => {
      window.localStorage.setItem('tale-theme', 'light');
      window.localStorage.setItem('user-locale', 'en');
    });
    const page = await context.newPage();

    let orgId = state[locale]?.orgId;
    if (!orgId) {
      console.log(`Creating the ${locale} demo org (${ORG_NAMES[locale]})…`);
      orgId = await createAdditionalOrg(page, ORG_NAMES[locale]);
      // Persist IMMEDIATELY — a later seeding failure must reuse this org on
      // retry, never mint another.
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(
        LOCALE_ORGS,
        `${JSON.stringify({ ...readState(), [locale]: { orgId, projects: {} } }, null, 2)}\n`,
      );
      await waitForScaffold(page, orgId);
    }

    console.log(`Seeding ${locale} org ${orgId}…`);
    const projects = await seedVideoLocaleOrg(page, orgId, content);

    const relaunchId = projects.get(content.projects[0]?.name ?? '');
    if (!relaunchId) {
      throw new Error(`No project id for "${content.projects[0]?.name}"`);
    }
    await ensureTriageStaged(page, orgId, relaunchId, content.stagedTasks);

    const next: LocaleOrgState = {
      orgId,
      projects: Object.fromEntries(projects),
    };
    const file = { ...readState(), [locale]: next };
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(LOCALE_ORGS, `${JSON.stringify(file, null, 2)}\n`);
    return next;
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(SCREENSHOTS_AUTH)) {
    throw new Error(
      `No auth state at ${SCREENSHOTS_AUTH} — run \`bun run docs:screenshots\` first.`,
    );
  }
  const arg = process.argv.indexOf('--locale');
  const locales = (
    arg >= 0 ? [process.argv[arg + 1]] : ['de', 'fr']
  ) as Exclude<Locale, 'en'>[];
  const browser = await chromium.launch();
  try {
    for (const locale of locales) {
      const state = await ensureLocaleOrg(browser, locale);
      console.log(`✓ ${locale} org ready: ${state.orgId}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('seed-locale-orgs failed:', error);
  process.exit(1);
});
