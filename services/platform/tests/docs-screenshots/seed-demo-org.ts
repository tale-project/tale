/**
 * Idempotent, UI-driven seeding of the docs demo workspace. Everything is
 * created through the real product surfaces (the same locator discipline as
 * the e2e specs) so the data always matches what the current UI produces —
 * a DB-level seed would rot on every schema change and skip validation.
 *
 * Idempotency is check-then-create by display name: re-running against a
 * half-seeded org fills only the gaps. All literals live in demo-content.ts.
 */

import { expect, type Page } from '@playwright/test';

import { matchDocsReply } from '../../lib/mocks/overrides/docs-replies';
import {
  deleteThreadById,
  sendNewThreadMessage,
  waitForReplyComplete,
} from '../e2e/helpers/chat';
import { TIMEOUT } from '../e2e/helpers/env';
import { t } from '../e2e/helpers/i18n';
import {
  DEMO_CHAT_PROMPTS,
  DEMO_DISCUSSIONS,
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_PROJECT_DESCRIPTION,
  DEMO_PROJECT_FILES,
  DEMO_PROJECTS,
  type DemoProject,
} from './demo-content';

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

  const existingRow = page
    .getByRole('row')
    .filter({ hasText: project.name })
    .first();
  if (await existingRow.isVisible().catch(() => false)) {
    await existingRow.getByText(project.name).click();
  } else {
    await createButton.click();
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
  }

  await page.waitForURL(PROJECT_URL, { timeout: TIMEOUT.NAV });
  const projectId = PROJECT_URL.exec(page.url())?.[1];
  if (!projectId) {
    throw new Error(`No project id in URL after opening "${project.name}"`);
  }

  await page.goto(`/dashboard/${orgId}/projects/${projectId}/tasks/board`);
  const newTaskButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await expect(newTaskButton).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  for (const title of project.tasks) {
    if (
      await page
        .getByText(title)
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
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog
      .getByRole('textbox', { name: t('tasks.fields.title') })
      .fill(title);
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
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/projects/${projectId}/files`);
  await expect(
    page.getByText(t('projects.files.emptyDescription')).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const doc of DEMO_PROJECT_FILES) {
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

/** Open the demo discussions in the project's Discussions tab. */
async function ensureDiscussions(
  page: Page,
  orgId: string,
  projectId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/projects/${projectId}/discussions`);
  const newButton = page.getByRole('button', { name: t('discussions.new') });
  await expect(newButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const discussion of DEMO_DISCUSSIONS) {
    if (
      await page
        .getByText(discussion.title)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      continue;
    }
    await newButton.click();
    const dialog = page.getByRole('dialog', {
      name: t('discussions.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await dialog
      .getByRole('textbox', { name: t('discussions.create.titleLabel') })
      .fill(discussion.title);
    await dialog
      .getByRole('button', {
        name: t(`discussions.categories.${discussion.category}`),
        exact: true,
      })
      .click();
    // The opening message uses the shared chat composer inside the dialog.
    await dialog
      .getByRole('textbox', { name: t('chat.aria.chatInput') })
      .fill(discussion.body);
    await dialog
      .getByRole('button', { name: t('chat.send'), exact: true })
      .click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    // Creation may land in the new discussion's thread view — return to the
    // list and confirm the row exists before seeding the next one.
    await page.goto(`/dashboard/${orgId}/projects/${projectId}/discussions`);
    await expect(page.getByText(discussion.title).first()).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }
}

/** Add the manual knowledge entries (Knowledge > Knowledge entries). */
async function ensureKnowledgeEntries(
  page: Page,
  orgId: string,
): Promise<void> {
  await page.goto(`/dashboard/${orgId}/knowledge-entries`);
  const addButton = page.getByRole('button', {
    name: t('knowledgeEntries.addButton'),
  });
  await expect(addButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const entry of DEMO_KNOWLEDGE_ENTRIES) {
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

async function ensureDocuments(page: Page, orgId: string): Promise<void> {
  await page.goto(`/dashboard/${orgId}/documents`);
  const importButton = page.getByRole('button', {
    name: t('documents.upload.importDocuments'),
  });
  await expect(importButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  for (const doc of DEMO_DOCUMENTS) {
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

/** Seed (or top up) the demo org; returns the ids the shot manifest needs. */
export async function seedDemoOrg(
  page: Page,
  orgId: string,
): Promise<SeededIds> {
  const projects = new Map<string, string>();
  for (const project of DEMO_PROJECTS) {
    projects.set(project.name, await ensureProject(page, orgId, project));
  }
  // The flagship project gets the extra surfaces the docs shots show:
  // a filled identity, attached files, and open discussions.
  const relaunchId = projects.get(DEMO_PROJECTS[0].name);
  if (relaunchId) {
    await ensureProjectDescription(page, orgId, relaunchId);
    await ensureProjectFiles(page, orgId, relaunchId);
    await ensureDiscussions(page, orgId, relaunchId);
  }
  await ensureDocuments(page, orgId);
  await ensureKnowledgeEntries(page, orgId);
  const threads = await ensureChats(page, orgId);
  return { threads, projects };
}
