/**
 * The take's additive-only contract, as an API. Anything a scene creates ON
 * CAMERA is registered here the moment it exists — so even an aborted take
 * leaves the demo org exactly as seeded (a leftover wow thread once ambushed
 * the next take's picker locator). The recorder runs `runCleanup` in a
 * finally block, off camera, in its own en-locale context (the e2e chat
 * helpers resolve labels from the en catalog).
 *
 * Registered values are per-locale DATA literals (thread ids, entry topics,
 * agent display names, task titles) — the en-locale cleanup context finds
 * them regardless of the take locale. Every deletion is best-effort with a
 * warning: a cleanup failure must never mask the take's own error.
 */

import path from 'node:path';

import type { Browser, Page } from '@playwright/test';

import { BASE_URL } from '../../e2e/helpers/env';
import { SCREENSHOTS_STATE_DIR } from './paths';

/** What one take may leave behind; scenes register, the recorder sweeps. */
export class CleanupRegistry {
  private readonly threadIds = new Set<string>();
  private readonly entryTopics = new Set<string>();
  private readonly agentNames = new Set<string>();
  private readonly taskTitles = new Set<string>();
  private taskBoardUrl = '';

  /** A chat thread created on camera, by id (from the thread URL). */
  thread(id: string): void {
    if (id.trim()) this.threadIds.add(id.trim());
  }

  /** A knowledge entry created on camera, by its topic literal. */
  knowledgeEntry(topic: string): void {
    if (topic.trim()) this.entryTopics.add(topic.trim());
  }

  /** An agent created on camera, by display name (shown in the list row). */
  agent(name: string): void {
    if (name.trim()) this.agentNames.add(name.trim());
  }

  /** A task created on camera — archived on the board it was created on. */
  task(title: string, boardUrl: string): void {
    if (!title.trim()) return;
    this.taskTitles.add(title.trim());
    if (boardUrl.trim()) this.taskBoardUrl = boardUrl.trim();
  }

  get isEmpty(): boolean {
    return (
      this.threadIds.size === 0 &&
      this.entryTopics.size === 0 &&
      this.agentNames.size === 0 &&
      this.taskTitles.size === 0
    );
  }

  snapshot(): {
    readonly threadIds: readonly string[];
    readonly entryTopics: readonly string[];
    readonly agentNames: readonly string[];
    readonly taskTitles: readonly string[];
    readonly taskBoardUrl: string;
  } {
    return {
      threadIds: [...this.threadIds],
      entryTopics: [...this.entryTopics],
      agentNames: [...this.agentNames],
      taskTitles: [...this.taskTitles],
      taskBoardUrl: this.taskBoardUrl,
    };
  }
}

async function deleteThreads(
  page: Page,
  orgId: string,
  threadIds: readonly string[],
): Promise<void> {
  if (threadIds.length === 0) return;
  await page.goto(`/dashboard/${orgId}/chat`, {
    waitUntil: 'domcontentloaded',
  });
  const { deleteThreadById } = await import('../../e2e/helpers/chat');
  // Thread rows live in the chat sub-panel, always visible on chat routes
  // at desktop width — no drawer to open first.
  for (const id of threadIds) {
    // The app deletes some registered threads itself (an Arena branch on
    // exit) — skip rows that are already gone instead of timing out.
    // `isVisible()` never waits — use a bounded waitFor so a still-loading
    // list cannot read as "already gone".
    const row = page.locator(`[data-thread-id="${id}"]`).first();
    const present = await row
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) {
      console.log(`  · thread ${id} already gone`);
      continue;
    }
    try {
      await deleteThreadById(page, id);
      console.log(`  ✓ cleaned up thread ${id}`);
    } catch (error) {
      console.warn(
        `  ! could not delete thread ${id} — remove it by hand:`,
        error,
      );
    }
  }
}

async function deleteKnowledgeEntries(
  page: Page,
  orgId: string,
  topics: readonly string[],
): Promise<void> {
  for (const topic of topics) {
    try {
      await page.goto(`/dashboard/${orgId}/knowledge-entries`, {
        waitUntil: 'domcontentloaded',
      });
      // Wait for the list to resolve before judging the row's absence.
      await page
        .getByRole('button', { name: 'Add entry' })
        .waitFor({ state: 'visible', timeout: 15_000 });
      const row = page.getByRole('row').filter({ hasText: topic }).first();
      const present = await row
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!present) {
        console.log(`  · entry "${topic}" already gone`);
        continue;
      }
      // Row menu → Delete → confirm (the dialog's button shares the label).
      await row.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      const dialog = page.getByRole('dialog', {
        name: 'Delete knowledge entry',
      });
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      await dialog.getByRole('button', { name: 'Delete' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 });
      console.log(`  ✓ cleaned up knowledge entry "${topic}"`);
    } catch (error) {
      console.warn(
        `  ! could not delete entry "${topic}" — remove it by hand:`,
        error,
      );
    }
  }
}

async function deleteAgents(
  page: Page,
  orgId: string,
  names: readonly string[],
): Promise<void> {
  for (const name of names) {
    try {
      await page.goto(`/dashboard/${orgId}/agents`, {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByRole('button', { name: 'Create agent' })
        .waitFor({ state: 'visible', timeout: 15_000 });
      const row = page.getByRole('row').filter({ hasText: name }).first();
      const present = await row
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!present) {
        console.log(`  · agent "${name}" already gone`);
        continue;
      }
      await row.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      await page
        .getByRole('button', { name: 'Delete agent', exact: true })
        .click();
      await row.waitFor({ state: 'hidden', timeout: 15_000 });
      console.log(`  ✓ cleaned up agent "${name}"`);
    } catch (error) {
      console.warn(
        `  ! could not delete agent "${name}" — remove it by hand:`,
        error,
      );
    }
  }
}

async function archiveTasks(
  page: Page,
  titles: readonly string[],
  boardUrl: string,
): Promise<void> {
  if (!boardUrl) return;
  for (const title of titles) {
    try {
      await page.goto(boardUrl, { waitUntil: 'domcontentloaded' });
      const card = page.getByText(title).first();
      const present = await card
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!present) {
        console.log(`  · task "${title}" already gone`);
        continue;
      }
      await card.click();
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor({ state: 'visible', timeout: 15_000 });
      // Archive lives directly in the dialog, or under its ⋯ menu.
      const direct = dialog.getByRole('button', { name: 'Archive' }).first();
      if (await direct.isVisible().catch(() => false)) {
        await direct.click();
      } else {
        await dialog
          .getByRole('button', { name: 'More actions' })
          .first()
          .click();
        await page.getByRole('menuitem', { name: 'Archive' }).first().click();
      }
      const confirm = page.getByRole('dialog', { name: 'Archive task?' });
      await confirm.waitFor({ state: 'visible', timeout: 10_000 });
      await confirm.getByRole('button', { name: 'Archive' }).click();
      await confirm.waitFor({ state: 'hidden', timeout: 10_000 });
      console.log(`  ✓ archived task "${title}"`);
    } catch (error) {
      console.warn(
        `  ! could not archive task "${title}" — archive it by hand:`,
        error,
      );
    }
  }
}

/**
 * Sweep everything the registry recorded, in its own en-locale context.
 * Called from the recorder's finally — even when the take aborted.
 */
export async function runCleanup(
  browser: Browser,
  orgId: string,
  registry: CleanupRegistry,
): Promise<void> {
  if (registry.isEmpty) return;
  const { threadIds, entryTopics, agentNames, taskTitles, taskBoardUrl } =
    registry.snapshot();
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: path.join(SCREENSHOTS_STATE_DIR, 'auth.json'),
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  try {
    await context.addInitScript(() => {
      window.localStorage.setItem('user-locale', 'en');
    });
    const page = await context.newPage();
    await deleteThreads(page, orgId, threadIds);
    await deleteKnowledgeEntries(page, orgId, entryTopics);
    await deleteAgents(page, orgId, agentNames);
    await archiveTasks(page, taskTitles, taskBoardUrl);
  } catch (error) {
    console.warn('  ! cleanup context failed — check the org by hand:', error);
  } finally {
    await context.close();
  }
}
