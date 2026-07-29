/**
 * Idempotent, UI-driven seeding of the docs demo workspace. Everything is
 * created through the real product surfaces (the same locator discipline as
 * the e2e specs) so the data always matches what the current UI produces —
 * a DB-level seed would rot on every schema change and skip validation.
 *
 * Idempotency is check-then-create by display name: re-running against a
 * half-seeded org fills only the gaps. All literals live in demo-content.ts.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { expect, type Locator, type Page } from '@playwright/test';

import { matchDocsReply } from '../../lib/mocks/overrides/docs-replies';
import { E2E_PASSWORD } from '../e2e/helpers/auth';
import {
  deleteThreadById,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../e2e/helpers/chat';
import { TIMEOUT } from '../e2e/helpers/env';
import { labelStart } from '../e2e/helpers/forms';
import { t } from '../e2e/helpers/i18n';
import {
  DEMO_API_KEYS,
  DEMO_CHAT_PROMPTS,
  DEMO_CUSTOM_INSTRUCTIONS,
  DEMO_DEPARTING_MEMBER,
  DEMO_DOCUMENTS,
  DEMO_ENV_VARS,
  DEMO_ERASURE_REQUEST,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_LEGAL_HOLD_REASON,
  DEMO_LEGAL_MATTER,
  DEMO_MEMBERS,
  DEMO_OWNER,
  DEMO_PROJECT_AGENTS,
  DEMO_PROJECT_DESCRIPTION,
  DEMO_PROJECT_FILES,
  DEMO_PROJECT_MODELS,
  DEMO_PROJECTS,
  DEMO_PRODUCTS,
  DEMO_TEAMS,
  DEMO_WEBDAV_LABELS,
  type DemoDocument,
  type DemoKnowledgeEntry,
  type DemoProduct,
  type DemoProject,
} from './demo-content';

/** The member the legal hold freezes — never the erasure subject (a hold BLOCKS
 *  erasure of the same person, which is the product working as designed). */
const HELD_MEMBER = DEMO_MEMBERS[2];

/** The phrase the erasure dialog demands, typed out (file-request-dialog.tsx). */
const ERASURE_CONFIRM_PHRASE = 'ERASE';

/** True when the text is already on the page — the check of check-then-create. */
const isPresent = (locator: Locator): Promise<boolean> =>
  locator
    .first()
    .isVisible()
    .catch(() => false);

/**
 * Block until a list page's rows have actually resolved.
 *
 * Every table here paints its chrome — the search box, the Create button — long
 * before its rows arrive, and an UNRESOLVED table is indistinguishable from an
 * EMPTY one. A check-then-create that fires in that window re-creates what
 * already exists: it made four "Growth" teams across four runs, and re-created
 * a project until the mutation threw PROJECT_KEY_TAKEN.
 *
 * The row-count footer ("Showing all N …", role=status) renders only once the
 * list query has returned, so it is the honest settled marker.
 */
async function settleList(page: Page): Promise<void> {
  await expect(page.getByRole('status').first()).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
}

/**
 * Like settleList, for pages that REPLACE the table (footer included) with an
 * empty-state hero when they hold no rows — on a fresh org the documents page
 * shows "No documents yet" and no role=status ever arrives. Settle on
 * whichever renders first; when it is the empty state, grant the query one
 * flash window to disprove it (the DataTable paints `data ?? []` while the
 * query is still in flight, so a just-loading table can masquerade as empty).
 */
async function settleListOrEmpty(page: Page, empty: Locator): Promise<void> {
  await expect(page.getByRole('status').first().or(empty.first())).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  if (await isPresent(empty)) {
    await page.waitForTimeout(750);
  }
}

/**
 * Has this record already been seeded? Gives the row a bounded window to show up
 * before answering "no".
 *
 * These governance tables carry no row-count footer to settle on, and their
 * EMPTY STATE is not a settled signal either — the DataTable renders it while
 * the query is still in flight (`data ?? []`), so it flashes up before the row
 * arrives. Reading that flash as "not seeded yet" made the seeder file a SECOND
 * legal hold / erasure request, which the mutation refuses — leaving the dialog
 * open until the run timed out. Only the row's own appearance is trustworthy.
 */
async function alreadySeeded(record: Locator): Promise<boolean> {
  return record
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUT.VISIBLE })
    .then(() => true)
    .catch(() => false);
}

interface SeededIds {
  /** Thread id per chat prompt. */
  readonly threads: Map<string, string>;
  /** Project id per project name. */
  readonly projects: Map<string, string>;
}

const PROJECT_URL = /\/projects\/([A-Za-z0-9]{16,})/;

async function ensureProject(
  page: Page,
  orgId: string,
  project: DemoProject,
): Promise<string> {
  await page.goto(`/dashboard/${orgId}/projects`);
  const createButton = page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await settleList(page);

  const existingRow = page
    .getByRole('row')
    .filter({ hasText: project.name })
    .first();
  if (await existingRow.isVisible().catch(() => false)) {
    // Opening an EXISTING project is a client-side route change, and a click
    // that lands before the router hydrates is swallowed silently — the page
    // just sits on the list. (The create path below never sees this: its
    // navigation is driven by the mutation, not the click.) Retry until the URL
    // actually moves.
    const ATTEMPTS = 5;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await existingRow.getByText(project.name).click();
      try {
        await page.waitForURL(PROJECT_URL, { timeout: TIMEOUT.VISIBLE });
        break;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          throw new Error(
            `Opening the existing project "${project.name}" never navigated.`,
            { cause: err },
          );
        }
        console.warn(
          `Project row click swallowed before hydration — retrying "${project.name}"`,
        );
      }
    }
  } else {
    // Same hydration discipline as the open path: on a freshly-created org
    // the page can still be settling — a click can report "outside of the
    // viewport" or the dialog's submit can be swallowed. Reload and retry.
    const ATTEMPTS = 4;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await createButton.click({ timeout: TIMEOUT.VISIBLE });
        const dialog = page.getByRole('dialog', {
          name: t('projects.create.title'),
        });
        await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
        await dialog
          .getByRole('textbox', { name: t('projects.create.nameLabel') })
          .fill(project.name);
        await dialog
          .getByRole('button', { name: t('projects.create.submit') })
          .click();
        await page.waitForURL(PROJECT_URL, { timeout: TIMEOUT.NAV });
        break;
      } catch (err) {
        if (attempt === ATTEMPTS) {
          throw new Error(
            `Creating the project "${project.name}" never navigated.`,
            { cause: err },
          );
        }
        console.warn(
          `Project create raced hydration — retrying "${project.name}"`,
        );
        await page.reload();
        await expect(createButton).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
      }
    }
  }

  const projectId = PROJECT_URL.exec(page.url())?.[1];
  if (!projectId) {
    throw new Error(`No project id in URL after opening "${project.name}"`);
  }

  await page.goto(`/dashboard/${orgId}/projects/${projectId}/tasks/board`);
  const newTaskButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await expect(newTaskButton).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  for (const task of project.tasks) {
    if (await isPresent(page.getByText(task.title))) continue;
    await newTaskButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('tasks.actions.create'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog
      .getByRole('textbox', { name: t('tasks.fields.title') })
      .fill(task.title);
    // The create dialog carries the Status picker, and the default is `todo` —
    // setting it HERE is what spreads the board across its columns. Dragging is
    // not an option: the board is @dnd-kit with a pointer sensor.
    if (task.status !== 'todo') {
      await dialog
        .getByRole('button', { name: t('tasks.fields.status') })
        .click();
      // Each option renders its label AND a status badge carrying the same
      // words, so the accessible name is doubled ("In progress In progress") —
      // an exact match never lands.
      await page
        .getByRole('option', { name: t(`tasks.status.${task.status}`) })
        .first()
        .click();
    }
    await dialog
      .getByRole('button', { name: t('tasks.actions.create') })
      .click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
  }
  return projectId;
}

/** Fill the demo project's description (General tab identity) once. */
async function ensureProjectDescription(
  page: Page,
  orgId: string,
  projectId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/projects/${projectId}`);
  const description = page.getByRole('textbox', {
    name: t('projects.settings.description'),
  });
  await expect(description).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  if ((await description.inputValue()) !== '') return;
  await description.fill(DEMO_PROJECT_DESCRIPTION);
  const save = page.getByRole('button', { name: t('common.actions.save') });
  await save.click();
  // The Save/Discard cluster disables once the form is clean again.
  await expect(save).toBeDisabled({ timeout: TIMEOUT.PERSIST });
}

/** Attach the demo files to the project's Knowledge tab (upload dropzone). */
async function ensureProjectFiles(
  page: Page,
  orgId: string,
  projectId: string,
  files: readonly DemoDocument[] = DEMO_PROJECT_FILES,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/projects/${projectId}/files`);
  await expect(
    page.getByText(t('projects.files.emptyDescription')).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const doc of files) {
    if (
      await page
        .getByText(doc.fileName)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      continue;
    }
    await page.locator('#project-files-upload').setInputFiles({
      name: doc.fileName,
      mimeType: doc.mimeType,
      buffer: Buffer.from(doc.content),
    });
    await expect(page.getByText(doc.fileName).first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }
}

/** Add the manual knowledge entries (Knowledge > Knowledge entries). */
async function ensureKnowledgeEntries(
  page: Page,
  orgId: string,
  entries: readonly DemoKnowledgeEntry[] = DEMO_KNOWLEDGE_ENTRIES,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/knowledge-entries`);
  const addButton = page.getByRole('button', {
    name: t('knowledgeEntries.addButton'),
  });
  await expect(addButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // Same fresh-org shape as documents: empty page = hero, no footer.
  await settleListOrEmpty(
    page,
    page.getByText(t('emptyStates.knowledgeEntries.title')),
  );
  for (const entry of entries) {
    if (
      await page
        .getByText(entry.topic)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      continue;
    }
    await addButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('knowledgeEntries.addEntry'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog
      .getByRole('textbox', { name: t('knowledgeEntries.topic') })
      .fill(entry.topic);
    await dialog
      .getByRole('textbox', { name: t('knowledgeEntries.content') })
      .fill(entry.content);
    await dialog
      .getByRole('button', { name: t('common.actions.save') })
      .click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    await expect(page.getByText(entry.topic).first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }
}

async function ensureDocuments(
  page: Page,
  orgId: string,
  documents: readonly DemoDocument[] = DEMO_DOCUMENTS,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/documents`);
  const importButton = page.getByRole('button', {
    name: t('documents.upload.importDocuments'),
  });
  await expect(importButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // A documentless org replaces the table with the upload hero — no footer.
  await settleListOrEmpty(
    page,
    page.getByText(t('documents.emptyState.title')),
  );
  for (const doc of documents) {
    if (
      await page
        .getByRole('row')
        .filter({ hasText: doc.fileName })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      continue;
    }
    await importButton.click();
    await page
      .getByRole('menuitem', { name: t('documents.upload.fromYourDevice') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: t('documents.upload.importDocuments'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog.locator('#document-file-upload').setInputFiles({
      name: doc.fileName,
      mimeType: doc.mimeType,
      buffer: Buffer.from(doc.content),
    });
    await dialog
      .getByRole('button', { name: t('documents.upload.uploadDocuments') })
      .click();
    await expect(
      page.getByRole('row').filter({ hasText: doc.fileName }).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }
}

/**
 * Structured products (Knowledge > Products) — the typed-records surface
 * Episode 3 shows. The create dialog is a three-step wizard (basics → pricing
 * & inventory → review); every fill is scoped to the dialog, and the status
 * Select follows the combobox-then-option pattern from `ensureMembers`.
 */
async function ensureProducts(
  page: Page,
  orgId: string,
  products: readonly DemoProduct[] = DEMO_PRODUCTS,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/products`);
  const addButton = page.getByRole('button', {
    name: t('products.addButton'),
  });
  await expect(addButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // The products table renders no row-count footer, so `settleListOrEmpty`
  // cannot latch once rows exist: settled is the empty-state hero OR the
  // first data row (header is row 0).
  await expect(
    page
      .getByText(t('emptyStates.products.title'))
      .first()
      .or(page.getByRole('row').nth(1)),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const product of products) {
    if (
      await isPresent(page.getByRole('row').filter({ hasText: product.name }))
    )
      continue;
    // "Add product" is an action menu (import from device | manual entry).
    await addButton.click();
    await page
      .getByRole('menuitem', { name: t('products.importMenu.manualEntry') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: t('products.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Step 1 — basics.
    await dialog.getByLabel(t('products.edit.labels.name')).fill(product.name);
    await dialog
      .getByLabel(t('products.edit.labels.description'))
      .fill(product.description);
    await dialog
      .getByRole('button', { name: t('common.actions.next') })
      .click();
    // Step 2 — pricing & inventory.
    await dialog
      .getByLabel(t('products.edit.labels.price'))
      .fill(product.price);
    await dialog
      .getByLabel(t('products.edit.labels.currency'))
      .fill(product.currency);
    if (product.stock) {
      await dialog
        .getByLabel(t('products.edit.labels.stock'))
        .fill(product.stock);
    }
    await dialog
      .getByLabel(t('products.edit.labels.category'))
      .fill(product.category);
    await dialog
      .getByRole('combobox', { name: t('products.create.labels.status') })
      .click();
    await page
      .getByRole('option', {
        name: t(`common.status.${product.status}`),
        exact: true,
      })
      .click();
    await dialog
      .getByRole('button', { name: t('common.actions.next') })
      .click();
    // Step 3 — review → create.
    await dialog
      .getByRole('button', { name: t('common.actions.create') })
      .click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    await expect(
      page.getByRole('row').filter({ hasText: product.name }).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }
}

const execFileAsync = promisify(execFile);
const PLATFORM_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../..',
);

/**
 * Install the builtin Researcher agent (an enabled `agentInstallations`
 * row). `metadata.autoInstall` is false for it, and the agent-catalog
 * installer UI is not mounted anywhere yet — the internal mutation is the
 * only lever, the same row the provisioner writes. Replace with the
 * UI-driven flow once the catalog installer ships. Idempotent (upsert).
 */
async function ensureResearcherInstalled(orgId: string): Promise<void> {
  // The external agents ride along for the developer episode — same rationale.
  for (const agentSlug of ['researcher', 'claude-code', 'cursor']) {
    await execFileAsync(
      'bunx',
      [
        'convex',
        'run',
        'agents/installations:upsertInstallation',
        JSON.stringify({
          organizationId: orgId,
          agentSlug,
          installedBy: 'docs-demo-seed',
          contentHash: 'docs-demo-seed',
          enabled: true,
        }),
      ],
      { cwd: PLATFORM_DIR },
    );
  }
}

/**
 * Connect the Tavily integration so integration-bound builtin agents — the
 * Researcher — offer themselves in the chat agent picker. Outbound Tavily
 * HTTP is rewritten to the mock gateway (`TALE_MOCK_INTEGRATIONS_BASE`), so
 * the key value is arbitrary and nothing ever leaves the machine.
 */
async function ensureTavilyIntegration(
  page: Page,
  orgId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/integrations`);
  const allTab = page
    .getByText(t('settings.integrations.tabs.all'), { exact: true })
    .first();
  await expect(allTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await allTab.click();
  // The catalog card's accessible name grows a "Connected" badge once the
  // integration is live — never match it exactly.
  const card = page.getByRole('button', { name: /Tavily/ }).first();
  await expect(card).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  if (
    await isPresent(card.getByText(t('settings.integrations.badge.connected')))
  ) {
    return;
  }
  await card.click();
  const dialog = page.getByRole('dialog').last();
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // The connector's single auth field; role-scoped so the label's casing
  // (connector data, not chrome) cannot break the fill.
  await dialog.getByRole('textbox').first().fill('tvly-docs-demo-mock-key');
  await dialog
    .getByRole('button', {
      name: t('settings.integrations.panel.connectName').replace(
        '{name}',
        'Tavily',
      ),
    })
    .click();
  // The catalog card does not live-update its badge; the details panel
  // flips to "Active" — that is the persisted-connection signal.
  await expect(dialog.getByText(t('common.status.active')).first()).toBeVisible(
    { timeout: TIMEOUT.PERSIST },
  );
  const close = dialog.getByRole('button', {
    name: t('common.actions.close'),
  });
  if (await isPresent(close)) await close.click();
}

async function ensureChats(
  page: Page,
  orgId: string,
): Promise<Map<string, string>> {
  const threads = new Map<string, string>();
  for (const prompt of DEMO_CHAT_PROMPTS) {
    // The scripted answer this prompt must show (docs-replies.ts); its first
    // prose words double as the verification text. A thread carrying the
    // generic canned reply instead is stale — seeded before the mock knew the
    // phrase — and gets deleted and re-created.
    const scripted = matchDocsReply(prompt);
    if (!scripted) {
      throw new Error(
        `Demo prompt has no docs reply (demo-content.ts pairs 1:1): "${prompt}"`,
      );
    }
    const expectedReply = scripted.reply.split('\n')[0].slice(0, 40);

    // Thread titles derive from the prompt text (the mock's router path
    // returns `{}`, so the fallback title is the trimmed user message) —
    // an existing History entry starting with the prompt means this chat is
    // already seeded; open it to record its id.
    await page.goto(`/dashboard/${orgId}/chat`);
    const historyEntry = page
      .getByText(prompt.slice(0, 40), { exact: false })
      .first();
    if (await historyEntry.isVisible().catch(() => false)) {
      await historyEntry.click();
      await page.waitForURL(/\/chat\/[A-Za-z0-9]{16,}/, {
        timeout: TIMEOUT.NAV,
      });
      const threadId = /\/chat\/([A-Za-z0-9]{16,})/.exec(page.url())?.[1];
      const replyVisible = await page
        .getByText(expectedReply)
        .first()
        .isVisible()
        .catch(() => false);
      if (threadId && replyVisible) {
        threads.set(prompt, threadId);
        continue;
      }
      if (threadId) {
        console.warn(`Re-seeding stale demo chat: "${prompt.slice(0, 40)}…"`);
        await deleteThreadById(page, threadId);
        await page.goto(`/dashboard/${orgId}/chat`);
      }
    }
    const threadId = await sendNewThreadMessage(page, prompt);
    await waitForReplyComplete(page);
    await expect(page.getByText(expectedReply).first()).toBeVisible({
      timeout: TIMEOUT.REPLY,
    });
    threads.set(prompt, threadId);
  }
  return threads;
}

/**
 * Provision the rest of the workspace's people (Settings > Organization).
 * Members are admin-created with a password — there is no invite mail to
 * accept — so the Members table shows a team instead of a lone owner, and the
 * governance surfaces get subjects to act on.
 */
async function ensureMembers(
  page: Page,
  orgId: string,
  members: readonly (typeof DEMO_MEMBERS)[number][] = DEMO_MEMBERS,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/organization`);
  const addButton = page.getByRole('button', {
    name: t('settings.organization.addMember'),
  });
  await expect(addButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // This page renders several role=status regions (the org form's save state
  // among them), so settleList would latch onto the wrong one. The owner's row
  // is always in the members table once it has resolved.
  await expect(
    page.getByRole('row').filter({ hasText: DEMO_OWNER.email }).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const member of members) {
    if (await isPresent(page.getByText(member.email))) continue;
    await addButton.click();
    // The dialog title AND its submit button both read "Add member" — scope
    // every fill and the submit to the dialog.
    const dialog = page.getByRole('dialog', {
      name: t('dialogs.addMember.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog.getByLabel(t('settings.form.name')).fill(member.name);
    await dialog.getByLabel(t('settings.form.email')).fill(member.email);
    await dialog
      .getByRole('combobox', { name: t('settings.form.role') })
      .click();
    await page
      .getByRole('option', {
        name: t(`settings.roles.${member.role}`),
        exact: true,
      })
      .click();
    // type=password exposes no textbox role, and the show/hide toggle's label
    // also contains "Password" — match the label exactly. The field only
    // exists for NEW accounts — but it RENDERS until the async
    // email-existence check answers, so probing it right after the email
    // fill races the check: the seeder filled passwords for accounts that
    // already exist (the video locale orgs re-add the shared-org people) and
    // the submit flow forked into a state the loop never dismissed. Settle
    // the check first: the existing-user hint appears, or the field is the
    // truth.
    const existingHint = dialog.getByText(
      t('dialogs.addMember.existingUserHint'),
    );
    const password = dialog.getByLabel(t('settings.form.password'), {
      exact: true,
    });
    await expect(existingHint.or(password)).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
    await page.waitForTimeout(750); // one flash window for a late hint
    const needsPassword = !(await isPresent(existingHint));
    if (needsPassword) await password.fill(E2E_PASSWORD);
    await dialog
      .getByRole('button', { name: t('dialogs.addMember.title') })
      .click();
    // The "member added" view stays open until acknowledged — a NEW account
    // carries the shown-once credentials, and an existing-account add shows
    // the same confirmation without them. Acknowledge whichever appears; a
    // new account MUST produce it (the credentials show exactly once).
    const credentials = page.getByRole('dialog', {
      name: t('dialogs.memberAdded.title'),
    });
    const confirmed = await credentials
      .waitFor({
        state: 'visible',
        timeout: needsPassword ? TIMEOUT.PERSIST : 5_000,
      })
      .then(() => true)
      .catch(() => false);
    if (needsPassword && !confirmed) {
      throw new Error(
        `Adding ${member.email} never surfaced the credentials view.`,
      );
    }
    if (confirmed) {
      await credentials
        .getByRole('button', { name: t('common.actions.done') })
        .click();
    }
    // Whatever the path, the NEXT iteration needs a dialog-free page — an
    // add that leaves any dialog standing hides the toolbar from ARIA and
    // times out the following click with a misleading "not found".
    await expect(page.getByRole('dialog')).toHaveCount(0, {
      timeout: TIMEOUT.VISIBLE,
    });
    await expect(page.getByText(member.email).first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }
}

/** Teams (Settings > Teams) — otherwise the table screenshots as "No teams yet". */
async function ensureTeams(
  page: Page,
  orgId: string,
  teams: readonly string[] = DEMO_TEAMS,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/teams`);
  const createButton = page
    .getByRole('button', { name: t('settings.teams.createTeam') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // The teams table hides its row-count footer entirely at zero rows — no
  // role=status, no empty-state hero, just the header row — so a fresh org
  // gives settleList nothing to latch onto. Settle on footer-or-table and,
  // when the footer is absent, grant the query the same flash window
  // settleListOrEmpty grants an empty state.
  await expect(
    page.getByRole('status').first().or(page.getByRole('table').first()),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  if (!(await isPresent(page.getByRole('status')))) {
    await page.waitForTimeout(750);
  }
  for (const team of teams) {
    if (await isPresent(page.getByRole('row').filter({ hasText: team })))
      continue;
    await createButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('settings.teams.createTeam'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog.getByLabel(t('settings.teams.teamName')).fill(team);
    // Submitting with no members selected adds the current user.
    await dialog
      .getByRole('button', { name: t('settings.teams.createTeam') })
      .click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    await expect(
      page.getByRole('row').filter({ hasText: team }).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }
}

/** Personal environment variables and secrets (Settings > Environment). */
async function ensureEnvVars(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/environment`);
  const addButton = page.getByRole('button', { name: t('envEditor.add') });
  await expect(addButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // Rows are label-less inputs, so identity is the KEY's current value — a
  // saved secret re-renders as a mask, so the value can never be the check.
  const keyInputs = page.getByPlaceholder(t('envEditor.keyPlaceholder'));
  const existingKeys = await keyInputs.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );

  let added = false;
  for (const variable of DEMO_ENV_VARS) {
    if (existingKeys.includes(variable.key)) continue;
    await addButton.click();
    await page
      .getByPlaceholder(t('envEditor.keyPlaceholder'))
      .last()
      .fill(variable.key);
    await page
      .getByPlaceholder(t('envEditor.valuePlaceholder'))
      .last()
      .fill(variable.value);
    if (variable.secret) {
      await page
        .getByRole('checkbox', { name: t('envEditor.secret') })
        .last()
        .check();
    }
    added = true;
  }
  if (!added) return;
  // The row editor runs in externalSave mode: its Save lives in the settings
  // header, not in the form. The saved-state signal is the success toast, not
  // the button: saved SECRET rows re-render as masks, which can re-dirty the
  // form and re-enable Save right after a successful persist.
  const save = page.getByRole('button', { name: t('common.actions.save') });
  await save.click();
  await expect(page.getByText(t('envEditor.saved')).first()).toBeVisible({
    timeout: TIMEOUT.PERSIST,
  });
}

/** REST API keys (Settings > API > REST). */
async function ensureApiKeys(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/api/rest`);
  const createButton = page
    .getByRole('button', { name: t('settings.apiKeys.createKey') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await settleList(page);
  for (const name of DEMO_API_KEYS) {
    if (await isPresent(page.getByRole('row').filter({ hasText: name })))
      continue;
    await createButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('settings.apiKeys.createKey'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog.getByLabel(t('settings.apiKeys.form.name')).fill(name);
    await dialog
      .getByRole('button', {
        name: t('settings.apiKeys.createKeySubmit'),
        exact: true,
      })
      .click();
    // The same dialog swaps into the shown-once reveal view and never closes on
    // its own — dismiss it with Done.
    const created = page.getByRole('dialog', {
      name: t('settings.apiKeys.keyCreated'),
    });
    await expect(created).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await created
      .getByRole('button', { name: t('common.actions.done'), exact: true })
      .click();
    await expect(
      page.getByRole('row').filter({ hasText: name }).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }
}

/** WebDAV app-passwords (Settings > API > WebDAV). */
async function ensureWebdavPasswords(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/api/webdav`);
  const generateButton = page
    .getByRole('button', { name: t('webdav.create.submit') })
    .first();
  await expect(generateButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const label of DEMO_WEBDAV_LABELS) {
    if (await isPresent(page.getByRole('row').filter({ hasText: label })))
      continue;
    await generateButton.click();
    const dialog = page.getByRole('dialog', { name: t('webdav.create.title') });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog.getByLabel(t('webdav.create.labelLabel')).fill(label);
    await dialog
      .getByRole('button', { name: t('webdav.create.submit'), exact: true })
      .click();
    // The generated password is revealed exactly once and blocks the page until
    // it is acknowledged.
    const dismiss = page.getByRole('button', {
      name: t('webdav.create.dismiss'),
    });
    await expect(dismiss).toBeVisible({ timeout: TIMEOUT.PERSIST });
    await dismiss.click();
    await expect(
      page.getByRole('row').filter({ hasText: label }).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  }
}

/** Per-user custom instructions (Settings > Preferences). */
async function ensureCustomInstructions(
  page: Page,
  orgId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/personalization`);
  const toggle = page.getByRole('switch', {
    name: t('personalization.page.customInstructionsToggle.label'),
  });
  await expect(toggle).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  // The instructions field only mounts while the feature is switched on.
  if (!(await toggle.isChecked())) await toggle.click();

  const instructions = page.getByPlaceholder(
    t('personalization.page.customInstructions.placeholder'),
  );
  await expect(instructions).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  if ((await instructions.inputValue()) !== '') return;
  await instructions.fill(DEMO_CUSTOM_INSTRUCTIONS);
  const save = page.getByRole('button', { name: t('common.actions.save') });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT.PERSIST });
}

/** The project's curated agents and models (project > Agents & models). */
async function ensureProjectCuration(
  page: Page,
  orgId: string,
  projectId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/projects/${projectId}/agents`);
  const addAgent = page.getByRole('button', {
    name: t('projects.agents.addAgent'),
  });
  await expect(addAgent).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // In the default "Recommended" mode a listed entry IS a pin.
  //
  // The PICKER is the source of truth for "already pinned", not the rendered
  // list: the list arrives asynchronously, and reading it too early reports an
  // empty list and re-adds an entry that is already there. The picker only
  // offers what is NOT pinned yet, so an absent option means "already pinned" —
  // which makes this idempotent by construction.
  //
  // Anchor the option name (labelStart): an option's accessible name carries
  // the provider too ("Claude Sonnet 4.6openrouter"), so neither an exact match
  // nor a trailing word boundary lands — while a loose "Assistant" would also
  // hit "Automation Assistant".
  const pick = async (trigger: Locator, option: string): Promise<boolean> => {
    await trigger.click();
    // Never conclude "already pinned" from a picker that has not loaded.
    await expect(page.getByRole('option').first()).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
    const match = page
      .getByRole('option', { name: labelStart(option) })
      .first();
    if (!(await isPresent(match))) {
      await page.keyboard.press('Escape');
      return false;
    }
    await match.click();
    return true;
  };

  let added = false;
  for (const agent of DEMO_PROJECT_AGENTS) {
    if (await pick(addAgent, agent)) added = true;
  }
  const addModel = page.getByRole('button', {
    name: t('projects.agents.addModel'),
  });
  for (const model of DEMO_PROJECT_MODELS) {
    if (await pick(addModel, model)) added = true;
  }
  if (!added) return;
  const save = page.getByRole('button', { name: t('common.actions.save') });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT.PERSIST });
}

/**
 * Governance > Legal hold: a matter, and a hold placed under it. The subject is
 * HELD_MEMBER — never the erasure subject, because a hold legitimately BLOCKS
 * erasure of the same person.
 */
async function ensureLegalHold(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/settings/governance/legal-hold`);
  const placeHoldButton = page.getByRole('button', {
    name: t('governance.legalHold.actions.placeHold'),
  });
  await expect(placeHoldButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // The hold check comes FIRST — and gates the matter too. The holds table
  // identifies its target by EMAIL, not display name.
  if (await alreadySeeded(page.getByText(HELD_MEMBER.email))) return;

  if (!(await isPresent(page.getByText(DEMO_LEGAL_MATTER.caseNumber)))) {
    await page
      .getByRole('button', {
        name: t('governance.legalHold.actions.createMatter'),
      })
      .click();
    const matterDialog = page.getByRole('dialog', {
      name: t('governance.legalHold.dialogs.upsertMatter.createTitle'),
    });
    await expect(matterDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await matterDialog
      .getByLabel(
        labelStart(t('governance.legalHold.dialogs.upsertMatter.nameLabel')),
      )
      .fill(DEMO_LEGAL_MATTER.name);
    await matterDialog
      .getByLabel(
        labelStart(
          t('governance.legalHold.dialogs.upsertMatter.caseNumberLabel'),
        ),
      )
      .fill(DEMO_LEGAL_MATTER.caseNumber);
    await matterDialog
      .getByLabel(
        labelStart(
          t('governance.legalHold.dialogs.upsertMatter.descriptionLabel'),
        ),
      )
      .fill(DEMO_LEGAL_MATTER.description);
    await matterDialog
      .getByRole('button', {
        name: t('governance.legalHold.dialogs.upsertMatter.submitCreate'),
        exact: true,
      })
      .click();
    await expect(matterDialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
  }

  await placeHoldButton.click();
  const holdDialog = page.getByRole('dialog', {
    name: t('governance.legalHold.dialogs.placeHold.title'),
  });
  await expect(holdDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // targetType defaults to a user membership — only an org-wide hold demands a
  // typed confirmation phrase. The member and matter pickers are
  // SearchableSelects: a button trigger, then an option in the popover.
  await holdDialog
    .getByRole('button', {
      name: labelStart(
        t('governance.legalHold.dialogs.placeHold.userPickerLabel'),
      ),
    })
    .click();
  await page.getByRole('option', { name: HELD_MEMBER.name }).first().click();
  await holdDialog
    .getByLabel(
      labelStart(t('governance.legalHold.dialogs.placeHold.reasonLabel')),
    )
    .fill(DEMO_LEGAL_HOLD_REASON);
  await holdDialog
    .getByRole('button', {
      name: labelStart(t('governance.legalHold.dialogs.placeHold.matterLabel')),
    })
    .click();
  await page
    .getByRole('option', { name: DEMO_LEGAL_MATTER.name })
    .first()
    .click();
  await holdDialog
    .getByRole('button', {
      name: t('governance.legalHold.dialogs.placeHold.submit'),
      exact: true,
    })
    .click();
  await expect(holdDialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
}

/**
 * Governance > Data subject requests: one erasure request on file.
 *
 * `requestErasure` schedules a REAL cascade delete of the subject once the
 * cooling-off window (24h) passes — so the subject is a seeded contractor,
 * never the owner, and never a member another shot depends on.
 */
async function ensureErasureRequest(page: Page, orgId: string): Promise<void> {
  await page.goto(
    `/dashboard/${orgId}/settings/governance/data-subject-requests`,
  );
  const fileButton = page.getByRole('button', {
    name: t('governance.dataSubjectRequests.actions.fileRequest'),
  });
  await expect(fileButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  if (await alreadySeeded(page.getByText(DEMO_DEPARTING_MEMBER.name))) return;

  await fileButton.click();
  const dialog = page.getByRole('dialog', {
    name: t('governance.dataSubjectRequests.dialogs.fileRequest.title'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByRole('button', {
      name: labelStart(
        t('governance.dataSubjectRequests.dialogs.fileRequest.userPickerLabel'),
      ),
    })
    .click();
  await page
    .getByRole('option', { name: DEMO_DEPARTING_MEMBER.name })
    .first()
    .click();
  await dialog
    .getByRole('combobox', {
      name: t(
        'governance.dataSubjectRequests.dialogs.fileRequest.reasonCodeLabel',
      ),
    })
    .click();
  await page
    .getByRole('option', {
      name: t(
        `governance.dataSubjectRequests.reasonCodes.${DEMO_ERASURE_REQUEST.reasonCode}.label`,
      ),
      exact: true,
    })
    .click();
  await dialog
    .getByLabel(
      labelStart(
        t('governance.dataSubjectRequests.dialogs.fileRequest.reasonLabel'),
      ),
    )
    .fill(DEMO_ERASURE_REQUEST.reason);
  // The confirm input's placeholder IS the phrase it demands.
  await dialog
    .getByPlaceholder(ERASURE_CONFIRM_PHRASE)
    .fill(ERASURE_CONFIRM_PHRASE);
  await dialog
    .getByRole('button', {
      name: t('governance.dataSubjectRequests.dialogs.fileRequest.submit'),
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
}

/** Announce each phase — a silent 10-minute seed is undebuggable. */
async function step(label: string, run: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await run();
  console.log(`  · ${label} (${Math.round(performance.now() - started)}ms)`);
}

/** Seed (or top up) the demo org; returns the ids the shot manifest needs. */
export async function seedDemoOrg(
  page: Page,
  orgId: string,
): Promise<SeededIds> {
  console.log('Seeding the demo workspace…');
  // People first: teams, the legal hold and the erasure request all need
  // somebody to act on.
  await step('members', () => ensureMembers(page, orgId));
  await step('teams', () => ensureTeams(page, orgId));

  const projects = new Map<string, string>();
  for (const project of DEMO_PROJECTS) {
    await step(`project "${project.name}" + tasks`, async () => {
      projects.set(project.name, await ensureProject(page, orgId, project));
    });
  }
  // The flagship project gets the extra surfaces the docs shots show:
  // a filled identity, attached files, curated agents.
  const relaunchId = projects.get(DEMO_PROJECTS[0].name);
  if (relaunchId) {
    await step('project description', () =>
      ensureProjectDescription(page, orgId, relaunchId),
    );
    await step('project files', () =>
      ensureProjectFiles(page, orgId, relaunchId),
    );
    await step('project agents + models', () =>
      ensureProjectCuration(page, orgId, relaunchId),
    );
  }
  await step('documents', () => ensureDocuments(page, orgId));
  await step('knowledge entries', () => ensureKnowledgeEntries(page, orgId));
  await step('products', () => ensureProducts(page, orgId));
  await step('tavily integration', () => ensureTavilyIntegration(page, orgId));
  await step('researcher agent installed', () =>
    ensureResearcherInstalled(orgId),
  );

  // The settings surfaces that otherwise screenshot as bare empty states.
  await step('environment variables', () => ensureEnvVars(page, orgId));
  await step('API keys', () => ensureApiKeys(page, orgId));
  await step('WebDAV app-passwords', () => ensureWebdavPasswords(page, orgId));
  await step('custom instructions', () =>
    ensureCustomInstructions(page, orgId),
  );
  await step('legal hold', () => ensureLegalHold(page, orgId));
  await step('erasure request', () => ensureErasureRequest(page, orgId));

  const threads = new Map<string, string>();
  await step('chats', async () => {
    for (const [prompt, id] of await ensureChats(page, orgId)) {
      threads.set(prompt, id);
    }
  });
  return { threads, projects };
}

/**
 * Seed a VIDEO locale org (tests/docs-videos): only the surfaces the series'
 * cameras visit — projects with tasks, documents, knowledge entries, products
 * — with locale-native content. Chats, members, governance fixtures and the
 * rest of the full seed stay English-org-only (they are never on camera).
 * Idempotent like everything above; returns project ids by (localized)
 * project name.
 */
export async function seedVideoLocaleOrg(
  page: Page,
  orgId: string,
  content: {
    readonly projects: readonly DemoProject[];
    readonly documents: readonly DemoDocument[];
    readonly knowledgeEntries: readonly DemoKnowledgeEntry[];
    readonly products: readonly DemoProduct[];
    readonly teams: readonly string[];
    readonly projectFiles: readonly DemoDocument[];
  },
): Promise<Map<string, string>> {
  const projects = new Map<string, string>();
  for (const project of content.projects) {
    await step(`project "${project.name}" + tasks`, async () => {
      projects.set(project.name, await ensureProject(page, orgId, project));
    });
  }
  await step('documents', () =>
    ensureDocuments(page, orgId, content.documents),
  );
  await step('knowledge entries', () =>
    ensureKnowledgeEntries(page, orgId, content.knowledgeEntries),
  );
  await step('products', () => ensureProducts(page, orgId, content.products));
  await step('tavily integration', () => ensureTavilyIntegration(page, orgId));
  await step('researcher agent installed', () =>
    ensureResearcherInstalled(orgId),
  );
  await step('members', () => ensureMembers(page, orgId));
  await step('teams', () => ensureTeams(page, orgId, content.teams));
  const relaunch = projects.get(content.projects[0]?.name ?? '');
  if (relaunch) {
    await step('project files', () =>
      ensureProjectFiles(page, orgId, relaunch, content.projectFiles),
    );
  }
  return projects;
}
