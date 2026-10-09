import { expect, type Locator, type Page } from '@playwright/test';

import type { CaptureLocale } from '../../../platform/tests/docs-screenshots/capture-options';
import {
  DEMO_PROJECTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_CHAT_PROMPTS,
} from '../../../platform/tests/docs-screenshots/demo-content';
import { t } from '../../../platform/tests/docs-screenshots/i18n';
import type { ShotContext } from '../../../platform/tests/docs-screenshots/manifest';
import {
  composer,
  messageLog,
  sendButton,
} from '../../../platform/tests/e2e/helpers/chat';
import type { ProductScreenshotPage } from '../../app/content/product-screenshots';

export interface MotionScene {
  page: ProductScreenshotPage;
  sourceShot: string;
  action: string;
  prepare?: (page: Page, ctx: ShotContext) => Promise<void>;
  run: (
    page: Page,
    ownedThreads: Set<string>,
    locale: CaptureLocale,
  ) => Promise<void>;
  reset: (page: Page) => Promise<void>;
  beforeAssertion: (locale: CaptureLocale) => string;
  afterAssertion: (locale: CaptureLocale) => string;
  result: (page: Page) => Locator;
  resetOnCamera?: boolean;
}

const DRAFTS = {
  home: {
    en: 'The revised brief is ready for your review.',
    de: 'Das überarbeitete Briefing ist bereit zur Prüfung.',
    fr: 'Le brief révisé est prêt pour ta relecture.',
  },
  hub: {
    en: 'Thanks, Hannah. I will include both regional offices.',
    de: 'Danke, Hannah. Ich nehme beide Regionalbüros auf.',
    fr: 'Merci, Hannah. J’inclus les deux bureaux régionaux.',
  },
} as const;

const firstTask = DEMO_PROJECTS[0].tasks[0].title;
const dialog = (page: Page): Locator => page.getByRole('dialog').last();
const comment = (page: Page): Locator => page.locator('#new-comment');
const conversationEditor = (page: Page): Locator =>
  page.getByLabel(t('conversations.messagePlaceholder')).first();

export const MOTION_SCENES: readonly MotionScene[] = [
  {
    page: 'chat',
    sourceShot: 'chat-thread-reply',
    action: 'send-and-stream-grounded-reply',
    prepare: async (page, ctx) => {
      await page.goto(`/dashboard/${ctx.orgId}/chat?new=true`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(composer(page, t)).toBeVisible();
      await expect(
        page
          .getByRole('button', { name: t('chat.picker.ariaLabel') })
          .filter({ hasNotText: t('chat.modelSelector.noModelsAvailable') }),
      ).toBeVisible();
    },
    run: async (page, ownedThreads) => {
      await expect(composer(page, t)).toHaveValue('');
      await composer(page, t).pressSequentially(DEMO_CHAT_PROMPTS[0], {
        delay: 18,
      });
      await expect(sendButton(page, t)).toBeEnabled();
      await sendButton(page, t).click();
      await page.waitForURL(/\/chat\/[A-Za-z0-9_-]{16,}(?:[/?#]|$)/);
      const threadId = new URL(page.url()).pathname.split('/').at(-1);
      if (!threadId)
        throw new Error('New marketing chat has no owned thread id');
      ownedThreads.add(threadId);
      await expect(
        messageLog(page, t).getByText('Across the three onboarding calls'),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.getByRole('button', {
          name: t('chat.stopGenerating'),
          exact: true,
        }),
      ).toBeHidden({ timeout: 20000 });
    },
    reset: async () => {},
    resetOnCamera: false,
    beforeAssertion: () =>
      `textbox: ${t('chat.aria.chatInput')}; fresh chat empty`,
    afterAssertion: () =>
      `log: ${t('chat.aria.messageHistory')}; Across the three onboarding calls`,
    result: (page) => messageLog(page, t),
  },
  {
    page: 'agents',
    sourceShot: 'project-agents-models',
    action: 'inspect-agent-configuration',
    run: async (page) => {
      await page
        .getByRole('button', { name: t('projects.agents.rowView') })
        .first()
        .click();
      const detailsDialog = page.getByRole('dialog', {
        name: t('projects.agents.detailsTitle'),
      });
      await expect(
        detailsDialog.getByText('Content editor', { exact: true }),
      ).toBeVisible();
      await expect(
        detailsDialog.getByText(t('projects.agents.instructionsLabel'), {
          exact: true,
        }),
      ).toBeVisible();
    },
    reset: async (page) => {
      await page.keyboard.press('Escape');
    },
    beforeAssertion: () =>
      `button: ${t('projects.agents.rowView')}; Content editor`,
    afterAssertion: () =>
      `dialog: ${t('projects.agents.detailsTitle')}; Content editor; ${t('projects.agents.instructionsLabel')}`,
    result: dialog,
  },
  {
    page: 'home',
    sourceShot: 'project-task-detail',
    action: 'draft-task-comment',
    run: async (page, _ownedThreads, locale) => {
      await expect(comment(page)).toHaveValue('');
      await comment(page).pressSequentially(DRAFTS.home[locale], { delay: 28 });
      await expect(comment(page)).toHaveValue(DRAFTS.home[locale]);
    },
    reset: async (page) => {
      await comment(page).fill('');
    },
    beforeAssertion: () => `dialog: ${firstTask}; comment draft empty`,
    afterAssertion: (locale) => `textbox: ${DRAFTS.home[locale]}`,
    result: (page) => comment(page).locator('..'),
  },
  {
    page: 'hub',
    sourceShot: 'home-inbox',
    action: 'draft-inbox-reply',
    run: async (page, _ownedThreads, locale) => {
      await expect(conversationEditor(page)).toHaveText('');
      await conversationEditor(page).pressSequentially(DRAFTS.hub[locale], {
        delay: 28,
      });
      await expect(conversationEditor(page)).toContainText(DRAFTS.hub[locale]);
    },
    reset: async (page) => {
      await conversationEditor(page).fill('');
    },
    beforeAssertion: () =>
      `textbox: ${t('conversations.messagePlaceholder')}; reply draft empty`,
    afterAssertion: (locale) => `textbox: ${DRAFTS.hub[locale]}`,
    result: (page) => conversationEditor(page).locator('..'),
  },
  {
    page: 'projects',
    sourceShot: 'projects-task-board',
    action: 'open-task-brief',
    run: async (page) => {
      await page.getByText(firstTask, { exact: true }).click();
      await expect(page.getByRole('dialog', { name: firstTask })).toBeVisible();
      await expect(comment(page)).toBeVisible();
    },
    reset: async (page) => {
      await page.keyboard.press('Escape');
    },
    beforeAssertion: () => `task board: ${firstTask}`,
    afterAssertion: () => `dialog: ${firstTask}; comment textbox`,
    result: dialog,
  },
  {
    page: 'knowledge',
    sourceShot: 'knowledge-entries-list',
    action: 'find-and-read-knowledge',
    run: async (page) => {
      const search = page.getByPlaceholder(
        t('knowledgeEntries.searchPlaceholder'),
      );
      await search.click();
      await expect(search).toHaveValue('');
      await search.pressSequentially('Support', { delay: 90 });
      await page
        .getByText(DEMO_KNOWLEDGE_ENTRIES[0].topic, { exact: true })
        .click();
      await expect(
        dialog(page).getByText(DEMO_KNOWLEDGE_ENTRIES[0].content, {
          exact: true,
        }),
      ).toBeVisible();
    },
    reset: async (page) => {
      await page.keyboard.press('Escape');
      const search = page.getByPlaceholder(
        t('knowledgeEntries.searchPlaceholder'),
      );
      await search.click();
      await search.fill('');
    },
    beforeAssertion: () =>
      `searchbox: ${t('knowledgeEntries.searchPlaceholder')}; Support first-response target`,
    afterAssertion: () =>
      `dialog: ${t('knowledgeEntries.viewDialog.title')}; ${DEMO_KNOWLEDGE_ENTRIES[0].content}`,
    result: dialog,
  },
  {
    page: 'governance',
    sourceShot: 'governance-audit-logs',
    action: 'inspect-audit-entry',
    run: async (page) => {
      await page.getByRole('row').nth(1).click();
      await expect(
        page.getByRole('dialog', {
          name: t('settings.logs.audit.detailTitle'),
        }),
      ).toBeVisible();
      await expect(
        dialog(page)
          .getByText(t('settings.logs.audit.columns.actor'), {
            exact: true,
          })
          .first(),
      ).toBeVisible();
    },
    reset: async (page) => {
      await page.keyboard.press('Escape');
    },
    beforeAssertion: () =>
      `heading: ${t('settings.logs.heading')}; member audit rows`,
    afterAssertion: () =>
      `dialog: ${t('settings.logs.audit.detailTitle')}; ${t('settings.logs.audit.columns.actor')}`,
    result: dialog,
  },
  {
    page: 'automations',
    sourceShot: 'automation-run-detail',
    action: 'inspect-completed-run-step',
    run: async (page) => {
      await page.locator('[data-automation-node="report"]').click();
      await expect(
        page.getByRole('heading', { name: 'report', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(t('automations.editor.runTitle'), { exact: true }),
      ).toBeVisible();
      await page
        .getByText(t('automations.editor.runTitle'), { exact: true })
        .scrollIntoViewIfNeeded();
    },
    reset: async (page) => {
      await page.keyboard.press('Escape');
    },
    beforeAssertion: () =>
      `completed report node: ${t('automations.runs.nodeStatus.ok')}`,
    afterAssertion: () =>
      `heading: report; ${t('automations.editor.runTitle')}`,
    result: (page) =>
      page
        .getByText(t('automations.editor.runTitle'), { exact: true })
        .locator('..'),
  },
];
