/**
 * The declarative shot manifest — the single registry of every docs
 * screenshot. One entry per committed image: the route, the interactions that
 * reach the state, the readiness gate, and the crop. Regeneration is
 * `bun run docs:screenshots [-- --only <name>]`; an image that is not
 * declared here does not ship (`services/docs/tests/image-manifest.test.ts`).
 *
 * Conventions:
 *   - `name` is the dash-case output filename (content-named, never numbered);
 *     `section` picks the output dir `services/docs/public/images/<section>/`.
 *   - Locators resolve labels through the capture locale's `t()` — never a
 *     hardcoded English literal.
 *   - `readyWhen` waits on authoritative state (a locator), never on time.
 *   - `capture.element` crops to a region; omit for the full viewport.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import {
  DEFAULT_SANDBOX_QUOTA,
  DEFAULT_SANDBOX_WORKSPACES,
  sandboxQuotaTotal,
} from '@tale/shared/schemas/governance';

import {
  composer as chatComposer,
  messageLog as chatMessageLog,
  sendButton as chatSendButton,
} from '../e2e/helpers/chat';
import { TIMEOUT } from '../e2e/helpers/env';
import { labelStart } from '../e2e/helpers/forms';
import {
  DEMO_CHAT_PROMPTS,
  DEMO_DATA_NOTICE,
  DEMO_DOCUMENTS,
  DEMO_EMPTY_DOCUMENT,
  DEMO_FAILED_RUN,
  DEMO_INBOX,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_LAUNCH_TASK_DETAIL,
  DEMO_ORG_NAME,
  DEMO_OWNER,
  DEMO_PASSKEY_NAME,
  DEMO_PROJECT_AGENTS,
  DEMO_PROJECT_FILES,
  DEMO_PRODUCTS,
  DEMO_PROJECTS,
  DEMO_PROVIDER_CREDENTIAL,
  DEMO_SKILLS,
  DEMO_SSO_EXAMPLE,
  DEMO_TEST_RUN,
  DEMO_WEBDAV_RETIRED_LABEL,
  MOCK_PROVIDER_DISPLAY_NAME,
  MOCK_PROVIDER_SLUG,
} from './demo-content';
import { t } from './i18n';

const composer = (page: Page): Locator => chatComposer(page, t);
const messageLog = (page: Page): Locator => chatMessageLog(page, t);
const sendButton = (page: Page): Locator => chatSendButton(page, t);
// The unread-count badge contributes a suffix to the radio's accessible name.
const inboxView = (page: Page): Locator =>
  page.getByRole('radio', { name: labelStart(t('home.views.inbox')) });
const labelPrefix = (key: string): string => t(key).split('{')[0].trim();

export interface ShotContext {
  readonly orgId: string;
  /** Thread ids recorded by the seeder, keyed by their prompt. */
  readonly threads: ReadonlyMap<string, string>;
  /** Project ids recorded by the seeder, keyed by project name. */
  readonly projects: ReadonlyMap<string, string>;
}

export interface Shot {
  /** Dash-case output name → `<name>.webp`. */
  readonly name: string;
  /** Docs image section dir under `services/docs/public/images/`. */
  readonly section:
    | 'get-started'
    | 'platform'
    | 'self-hosted'
    | 'cloud'
    | 'develop'
    | 'tutorials';
  /** App route; `:orgId` is substituted from the context. */
  readonly route: string;
  /** Drive the page into the target state (open menus, focus fields, …). */
  readonly prepare?: (page: Page, ctx: ShotContext) => Promise<void>;
  /** The authoritative "state reached" gate. */
  readonly readyWhen: (page: Page, ctx: ShotContext) => Locator;
  /** Confirm a native route-topic control after data readiness. Required for
   * marketing captures, whose synthetic names may be the same in every language. */
  readonly localizedReadyWhen?: (page: Page, ctx: ShotContext) => Locator;
  /**
   * Sanitization ONLY — run after `readyWhen`, before the screenshot.
   * Replace instance-local values (loopback URLs, machine hostnames) with
   * their production-shaped equivalents so a published image never shows
   * the capture rig. Never fabricate content that would not exist.
   */
  readonly sanitize?: (page: Page, ctx: ShotContext) => Promise<void>;
  /** Element crop; omit for the full viewport. */
  readonly capture?: (page: Page, ctx: ShotContext) => Locator;
  /**
   * Put back org state that `prepare` changed and other shots would
   * otherwise photograph (a setting that shows up on every chat screen).
   * Runs after the capture, and after a failed one too.
   */
  readonly restore?: (page: Page, ctx: ShotContext) => Promise<void>;
  /** Viewport override (default 1440×900). */
  readonly viewport?: { width: number; height: number };
}

const chatThreadRoute = (ctx: ShotContext, prompt: string): string => {
  const threadId = ctx.threads.get(prompt);
  if (!threadId) {
    throw new Error(
      `No seeded thread for prompt "${prompt}" — run without --skip-seed.`,
    );
  }
  // Fully resolved — `:orgId` substitution only happens on `shot.route`,
  // never on URLs a `prepare` callback navigates to itself.
  return `/dashboard/${ctx.orgId}/chat/${threadId}`;
};

/** A label as a literal inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FEEDBACK_PROMPT = DEMO_CHAT_PROMPTS[0];
/**
 * A chat that ends in work needing a file, handed to a project agent. Named
 * by its words, not its place in the seed list: the launch checklist is no
 * seeded chat any more (`chat-arena-split` asks it in a chat of its own).
 */
const TASK_HANDOFF_PROMPT =
  'Plan the quarterly business review agenda for Friday';

/** The Confidentiality notice section on Governance > Policies & Limits. */
const dataNoticeSection = (page: Page): Locator =>
  page.getByRole('region', {
    name: t('governance.dataNotice.title'),
    exact: true,
  });

const dataNoticeSwitch = (page: Page): Locator =>
  dataNoticeSection(page).getByRole('switch', {
    name: t('governance.dataNotice.enabledLabel'),
    exact: true,
  });

/** The Skill sharing section on Governance > Policies & Limits. */
const skillSharingSection = (page: Page): Locator =>
  page.getByRole('region', {
    name: t('governance.skillSharing.title'),
    exact: true,
  });

/** The Image generation section on Governance > Models. */
const imageGenerationSection = (page: Page): Locator =>
  page.getByRole('region', {
    name: t('governance.imageGeneration.title'),
    exact: true,
  });

/** The Model endpoints for API keys section on Governance > Models. */
const modelEndpointsSection = (page: Page): Locator =>
  page.getByRole('region', {
    name: t('governance.modelAccess.modelApi.title'),
    exact: true,
  });

/** The Standard agent section on Governance > Models. */
const standardAgentSection = (page: Page): Locator =>
  page.getByRole('region', {
    name: t('governance.standardAgent.title'),
    exact: true,
  });

/** A capture-rig value and what a customer's page shows in its place. */
type RigSwap = readonly [rig: string, real: string];

/**
 * The mock gateway as the vendor it stands in for: the seeded credential
 * sits on the offline mock, while a customer's row names a real provider.
 */
const RIG_SWAPS: readonly RigSwap[] = [
  [MOCK_PROVIDER_DISPLAY_NAME, 'OpenRouter'],
  // The slug alone (`e2e-mock · model`) and as a model id's prefix.
  [MOCK_PROVIDER_SLUG, 'openrouter'],
  // The mock catalog's placeholder model, as a model the demo
  // organization's model access already names.
  ['e2e-chat-model', 'google/gemini-3-flash-preview'],
];

/**
 * Secrets the rig mints for a shot, as regular expressions (source text,
 * every match swapped): a sandbox join token becomes the stand-in the Add a
 * device dialog itself shows while it mints one, so a published image never
 * holds a usable secret.
 */
const RIG_SECRETS: readonly RigSwap[] = [
  ['tsdj_[0-9a-f]{64}', `tsdj_${'0'.repeat(64)}`],
];

/**
 * The one sanitizer for frames that show the capture rig: the page's own
 * origin (a redirect URL, a connection URL, an API endpoint, a link the app
 * builds from `window.location`), the mock gateway's names and the rig's
 * secrets become what a customer's page shows, in text and in read-only
 * fields alike, so no published image shows the rig. The origins are the
 * page's own and the ones the deployment reports (`SITE_URL`,
 * `SITE_ORIGINS`), so a stack on another port or host name (`E2E_BASE_URL`)
 * is sanitized too. It keeps swapping until the capture: a field a late
 * query remounts or refills prints the rig's values again, after the pass
 * that ran when the shot was ready.
 */
const replaceRigNames = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ swaps, secrets }) => {
      const environment = (
        window as Window & {
          __ENV__?: { SITE_URL?: string; SITE_ORIGINS?: string[] };
        }
      ).__ENV__;
      // The app prints absolute URLs from the origins the deployment
      // reports, which a capture on another host name does not share.
      const origins = new Set(
        [
          window.location.href,
          environment?.SITE_URL,
          ...(environment?.SITE_ORIGINS ?? []),
        ]
          .filter(
            (url): url is string => url !== undefined && URL.canParse(url),
          )
          .map((url) => new URL(url).origin),
      );
      const literals: RigSwap[] = [
        ...[...origins].map((origin): RigSwap => [
          origin,
          'https://tale.yourcompany.com',
        ]),
        ...swaps,
      ];
      const matchers = secrets.map(
        ([source, real]) => [new RegExp(source, 'g'), real] as const,
      );
      const swap = (text: string): string =>
        matchers.reduce(
          (out, [pattern, real]) => out.replace(pattern, real),
          literals.reduce(
            (out, [rig, real]) => out.split(rig).join(real),
            text,
          ),
        );
      const sweep = (): void => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          const next = swap(text);
          if (next !== text) node.textContent = next;
        }
        for (const field of document.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement
        >('input, textarea')) {
          // The default too: React writes a controlled field's value back
          // without a trace, but then re-syncs a default that differs from
          // it, and the observer sees that attribute change.
          for (const key of ['value', 'defaultValue'] as const) {
            const next = swap(field[key]);
            if (next !== field[key]) field[key] = next;
          }
        }
      };
      sweep();
      // Swapping is idempotent: the pass a swap itself triggers finds
      // nothing left to change, so the observer settles.
      new MutationObserver(sweep).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['value'],
      });
    },
    { swaps: RIG_SWAPS, secrets: RIG_SECRETS },
  );
};

/** Flip the notice switch and wait for its instant save to land. */
async function setDataNotice(page: Page, on: boolean): Promise<void> {
  const toggle = dataNoticeSwitch(page);
  await expect(toggle).toBeEnabled({ timeout: TIMEOUT.FIRST_PAINT });
  if ((await toggle.isChecked()) === on) return;
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response
        .url()
        .includes('/governance/policies/data_classification_notice'),
  );
  await toggle.click();
  expect((await saved).ok()).toBe(true);
  await expect(toggle).toBeChecked({ checked: on });
}
const RELAUNCH_PROJECT = DEMO_PROJECTS[0].name;
/** The Add budget rule dialog on Policies & Limits. */
const budgetRuleDialog = (page: Page): Locator =>
  page.getByRole('dialog', {
    name: t('governance.budgets.addRuleDialogTitle'),
  });
/** The seeded project without agents of its own. */
const ONBOARDING_PROJECT = DEMO_PROJECTS[1].name;

/** The tasks a conversation handed over, above its message box. */
const chatTaskTray = (page: Page): Locator =>
  page.getByRole('region', { name: t('chat.taskTray.label'), exact: true });

/**
 * Hand the relaunch chat over: the header's Create task → the project step
 * → the task dialog drafted from the chat, with the project's first agent
 * as the assignee (it has two, so none is picked for you). Answers the
 * dialog.
 */
async function openChatHandover(
  page: Page,
  ctx: ShotContext,
): Promise<Locator> {
  await page.goto(chatThreadRoute(ctx, TASK_HANDOFF_PROMPT), {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByRole('button', {
      name: t('chat.createTask.headerButton'),
      exact: true,
    })
    .click();
  const step = page.getByRole('dialog', {
    name: t('chat.createTask.projectTitle'),
  });
  await expect(step).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await step
    .getByRole('button', { name: t('chat.createTask.projectLabel') })
    .click();
  await page.getByRole('option', { name: RELAUNCH_PROJECT }).click();
  await step
    .getByRole('button', { name: t('chat.createTask.continue') })
    .click();
  // The form mounts only once the conversation is read, holding the draft
  // from its first paint: the description field is the last thing to land.
  const form = page.getByRole('dialog', { name: t('tasks.actions.create') });
  await expect(
    form.getByRole('textbox', { name: t('tasks.fields.description') }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await form
    .getByRole('button', { name: t('tasks.actions.assign'), exact: true })
    .click();
  await page
    .getByRole('listbox', { name: t('tasks.fields.assignee') })
    .getByRole('option', { name: DEMO_PROJECT_AGENTS[0].name })
    .click();
  return form;
}

/**
 * The explicit fresh composer. A bare `/chat` RESUMES the caller's most
 * recent thread, so a shot that wants the empty new-chat screen — or that
 * sends a message meant to start its own thread — must ask for a fresh one,
 * or it lands (and types) inside whatever thread was open last. `new=true`
 * is the form the in-app links send: the router parses search params as
 * JSON, so `?new=1` would arrive as a number.
 */
const FRESH_CHAT_ROUTE = '/dashboard/:orgId/chat?new=true';

const seededProjectId = (ctx: ShotContext, project: string): string => {
  const projectId = ctx.projects.get(project);
  if (!projectId) {
    throw new Error(
      `No seeded project "${project}" — run without --skip-seed.`,
    );
  }
  return projectId;
};

const projectRoute = (
  ctx: ShotContext,
  sub = '',
  project = RELAUNCH_PROJECT,
): string =>
  `/dashboard/${ctx.orgId}/projects/${seededProjectId(ctx, project)}${sub}`;

/** Keep catalog examples reproducible when the local organization also has
 * manual-test automations. Filter through the real search control; never
 * delete other fixtures or remove rows from the captured DOM. */
async function showTriageAutomationExamples(page: Page): Promise<void> {
  const search = page.getByRole('textbox', {
    name: t('automations.list.searchPlaceholder'),
    exact: true,
  });
  // SearchInput is readonly until focus to suppress password-manager
  // autofill. Enter it as a reader does before Playwright checks editability.
  await search.click();
  await search.fill('Triage');
  for (const slug of [
    'github-triage-issues',
    'gmail-triage-inbox',
    'imap-smtp-triage-inbox',
    'outlook-triage-inbox',
  ]) {
    await expect(page.getByText(slug, { exact: true })).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  }
  // Four matching examples plus the table's column-heading row.
  await expect(page.getByRole('row')).toHaveCount(5);
}

/** The Editor's canvas once its layout has landed: the chart is busy while
 * the layout engine arranges the nodes. */
const laidOutAutomationCanvas = (page: Page): Locator =>
  page
    .getByRole('group', {
      name: t('automations.canvas.ariaLabel'),
      exact: true,
    })
    .and(page.locator('[aria-busy="false"]'));

/** The node box (or Start, End, or a condition) with this id on the canvas. */
const flowNode = (page: Page, id: string): Locator =>
  page.locator(`[data-flow-node="${id}"]`);

/**
 * Wait until an automation's Editor can be photographed: the saved version
 * on screen, its canvas laid out, and the check of the draft settled — the
 * Problems button no longer says it is checking.
 */
async function settleAutomationEditor(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', {
      name: t('automations.detail.versionSelect'),
      exact: true,
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(laidOutAutomationCanvas(page)).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  const problems = page
    .locator('[data-slot="issue-count-button"]')
    .filter({ visible: true })
    .first();
  await expect(problems).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(problems).not.toHaveAccessibleName(
    new RegExp(escapeRegExp(t('issues.checking'))),
    { timeout: TIMEOUT.FIRST_PAINT },
  );
}

/** Open a node's inspector from its box on the canvas. */
async function openAutomationNode(page: Page, id: string): Promise<void> {
  const box = flowNode(page, id);
  await box.waitFor({ timeout: TIMEOUT.VISIBLE });
  await box.click();
}

/**
 * A plural message such as `{count, plural, one {# path} other {# paths}}`
 * as a pattern for any count. The e2e `t()` returns the raw message, and a
 * button that counts is found by its words, whatever the number.
 */
function pluralPattern(message: string): RegExp {
  const forms = [...message.matchAll(/\{([^{}]*)\}/g)].map((match) =>
    escapeRegExp(match[1] ?? '').replaceAll('#', String.raw`\d+`),
  );
  return new RegExp(`^(?:${forms.join('|')})$`);
}

export const SHOTS: readonly Shot[] = [
  {
    // The flagship hero: a finished, believable chat conversation.
    name: 'chat-thread-reply',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await page.goto(chatThreadRoute(ctx, FEEDBACK_PROMPT), {
        waitUntil: 'domcontentloaded',
      });
      // The picker reads "No models available" until the composer-options
      // action answers — never freeze that placeholder into the hero shot.
      await expect(
        page
          .getByRole('button', { name: t('chat.picker.ariaLabel') })
          .filter({ hasNotText: t('chat.modelSelector.noModelsAvailable') }),
      ).toBeVisible({ timeout: 20_000 });
    },
    readyWhen: (page) =>
      messageLog(page).getByText('Across the three onboarding calls'),
    localizedReadyWhen: composer,
  },
  {
    name: 'chat-composer',
    section: 'platform',
    route: FRESH_CHAT_ROUTE,
    // Not the textarea alone: the picker button shows "No models available"
    // until the composer-options action answers, so gate on the resolved
    // model label or the shot freezes the loading placeholder.
    readyWhen: (page) =>
      page
        .getByRole('button', { name: t('chat.picker.ariaLabel') })
        .filter({ hasNotText: t('chat.modelSelector.noModelsAvailable') }),
    capture: (page) =>
      // The composer strip plus its picker — the region a new user acts in.
      //
      // Cropping to the textbox's PARENT caught only the placeholder line
      // floating in white space: the toolbar row (+, the model picker, mic,
      // send) lives in a sibling. Take the innermost element that holds BOTH
      // the input and the send button — document order puts the outermost
      // ancestor first, so the last match is the composer itself.
      page
        .locator('div')
        .filter({ has: composer(page) })
        .filter({ has: sendButton(page) })
        .last(),
  },
  {
    name: 'chat-document-attachment',
    section: 'platform',
    route: FRESH_CHAT_ROUTE,
    prepare: async (page) => {
      const document = DEMO_DOCUMENTS[0];
      await expect(composer(page)).toBeVisible();
      await page.locator('input[type="file"]').setInputFiles({
        name: document.fileName,
        mimeType: document.mimeType,
        buffer: Buffer.from(document.content),
      });
      await expect(
        page.getByText(document.fileName, { exact: true }),
      ).toBeVisible();
      await composer(page).fill(
        'Summarize the changes in these brand guidelines.',
      );
      // The completed attachment shows its size instead of pipeline progress.
      // Send can queue a message while indexing, so it is not a readiness gate.
      await expect(
        page
          .getByText(document.fileName, { exact: true })
          .locator('..')
          .getByText(/^[\d.,]+\s*(?:B|KB|MB|GB)$/),
      ).toBeVisible({ timeout: TIMEOUT.EXECUTION });
      await expect(
        page.getByText(t('chat.indexingFailed'), { exact: true }),
      ).toBeHidden();
    },
    readyWhen: (page) =>
      page.getByRole('button', { name: t('chat.removeAttachment') }),
    capture: (page) =>
      page
        .locator('div')
        .filter({ has: composer(page) })
        .filter({ has: sendButton(page) })
        .last(),
  },
  {
    name: 'project-task-detail',
    section: 'platform',
    // The populated brief and saved discussion need the full dialog height.
    viewport: { width: 1440, height: 1000 },
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/tasks/board'));
      await page
        .getByText(DEMO_PROJECTS[0].tasks[0].title, { exact: true })
        .click();
    },
    // The conversation reads the discussion and the history in separate
    // queries. Wait for the seeded comment in the reading column.
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: DEMO_PROJECTS[0].tasks[0].title })
        .getByText(DEMO_LAUNCH_TASK_DETAIL.comment, { exact: true }),
    localizedReadyWhen: (page) =>
      page
        .getByRole('dialog', {
          name: DEMO_PROJECTS[0].tasks[0].title,
        })
        .getByRole('button', { name: labelStart(t('tasks.fields.priority')) }),
    capture: (page) =>
      page.getByRole('dialog', { name: DEMO_PROJECTS[0].tasks[0].title }),
  },
  {
    // The Repeat popover over the same task once a preset has dated it: the
    // one-click presets read off its due date, the due dates of the tasks it
    // will bring back, and the option to create the next one on the due
    // date. `restore` puts the task back undated and not repeating, so the
    // board and detail shots never show this rule.
    name: 'project-task-repeat',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      const title = DEMO_PROJECTS[0].tasks[0].title;
      await page.goto(projectRoute(ctx, '/tasks/board'));
      await page.getByText(title, { exact: true }).click();
      const dialog = page.getByRole('dialog', { name: title });
      const label = escapeRegExp(t('tasks.repeat.label'));
      await dialog
        .getByRole('button', { name: new RegExp(`^${label}:`) })
        .click();
      // "Weekly on <its weekday>", the fourth preset after Never, Daily and
      // Every weekday: picking it saves the rule and dates the task.
      await page
        .getByRole('radiogroup', { name: t('recurrence.presets') })
        .getByRole('radio')
        .nth(3)
        .click();
      const never = escapeRegExp(t('recurrence.never'));
      const repeating = dialog.getByRole('button', {
        name: new RegExp(`^${label}: (?!${never}$)`),
      });
      await repeating.waitFor();
      await repeating.click();
    },
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('tasks.repeat.label') })
        .getByText(t('tasks.repeat.nextDueDates')),
    restore: async (page, ctx) => {
      const title = DEMO_PROJECTS[0].tasks[0].title;
      await page.evaluate(
        async ({ orgId, taskTitle }) => {
          const list = await fetch(`/api/app/tasks?orgId=${orgId}`, {
            credentials: 'include',
          });
          const body: unknown = await list.json();
          const rows =
            typeof body === 'object' && body !== null && 'tasks' in body
              ? (body as { tasks: { id: string; title: string }[] }).tasks
              : [];
          const task = rows.find((row) => row.title === taskTitle);
          if (!task) throw new Error(`No task "${taskTitle}" to restore`);
          const reset = await fetch(
            `/api/app/tasks/${task.id}?orgId=${orgId}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ repeat: null, dueDate: null }),
            },
          );
          if (!reset.ok) throw new Error(`Restore answered ${reset.status}`);
        },
        { orgId: ctx.orgId, taskTitle: title },
      );
    },
  },
  {
    name: 'projects-task-board',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      const projectId = ctx.projects.get(RELAUNCH_PROJECT);
      if (!projectId) {
        throw new Error(
          `No seeded project "${RELAUNCH_PROJECT}" — run without --skip-seed.`,
        );
      }
      await page.goto(
        `/dashboard/${ctx.orgId}/projects/${projectId}/tasks/board`,
        { waitUntil: 'domcontentloaded' },
      );
    },
    readyWhen: (page) => page.getByText(DEMO_PROJECTS[0].tasks[0].title),
    localizedReadyWhen: (page) =>
      page
        .getByRole('button', { name: t('tasks.actions.create'), exact: true })
        .first(),
    // The board renders SIX columns (Backlog … Cancelled) beside the Home
    // panel, which a project page never folds away, and they do not fit the
    // standard 1440 frame — the last one gets sliced. Widen just this shot.
    // Keep 1.6:1 (2240×1400): the README gallery tiles are straight downscales
    // of these frames, and an off-ratio source would letterbox its tile.
    viewport: { width: 2240, height: 1400 },
  },
  {
    // The project's General tab — identity form, standing instructions, and
    // sharing. The whole page waits for the project record, and the sharing
    // section then waits for the teams query (until it answers, the Audience
    // row holds a spinner under the same label) — so the audience picker is
    // the last thing to settle and the honest "loaded" marker.
    name: 'project-general-tab',
    section: 'platform',
    // Taller than the default so the Sharing section clears the fold under
    // the Project rows and the Instructions editor; the fold sits on the seam
    // below Sharing, before the Archive section starts.
    viewport: { width: 1440, height: 1110 },
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/overview'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByRole('combobox', {
        name: t('projects.settings.audience'),
        exact: true,
      }),
  },
  {
    // The project's Knowledge tab — attached files with their index state
    // and the Add file dropzone. Wait for the LAST row's Indexed badge so
    // the shot never shows a half-indexed list.
    name: 'project-knowledge-files',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/files'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page
        .getByText(t('projects.files.ragStatusCompleted'))
        .nth(DEMO_PROJECT_FILES.length - 1),
  },
  {
    // The Agents tab — the project's crew, one row per agent with its harness,
    // provider, and model. Gate on a row's action button: the tab strip and
    // the section title both read "Agents" long before the list query
    // answers, so a text gate froze the skeleton.
    name: 'project-agents-models',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/agents'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByRole('button', { name: t('projects.agents.rowEdit') }).first(),
    localizedReadyWhen: (page) =>
      page.getByRole('button', {
        name: t('projects.agents.newAgent'),
        exact: true,
      }),
    // Each row names the provider serving its model.
    sanitize: replaceRigNames,
  },
  {
    // A new project agent starts with the document skills ticked, each row
    // naming who made it. The gate is the ticked docx row: the pre-tick only
    // lands once the skill catalog has answered.
    name: 'project-agent-document-skills',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/agents'), {
        waitUntil: 'domcontentloaded',
      });
      await page
        .getByRole('button', {
          name: t('projects.agents.newAgent'),
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: t('projects.agents.dialogCreateTitle'),
        exact: true,
      });
      await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await dialog
        .getByRole('button', { name: t('chat.skills.label'), exact: true })
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('menuitemcheckbox', { name: /^docx/, checked: true }),
  },
  {
    // A project without agents of its own: Assignee offers the
    // organization's standard agent, and the footer says it takes the
    // project's tasks until the project has agents. The Agents section sits
    // below the people, so the list scrolls to its end; nothing is picked,
    // and the project stays without agents.
    name: 'project-task-standard-agent',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      const title = DEMO_PROJECTS[1].tasks[0].title;
      await page.goto(projectRoute(ctx, '/tasks/board', ONBOARDING_PROJECT), {
        waitUntil: 'domcontentloaded',
      });
      await page.getByText(title, { exact: true }).click();
      await page
        .getByRole('dialog', { name: title })
        .getByRole('button', { name: t('tasks.actions.assign'), exact: true })
        .click();
      const list = page.getByRole('listbox', {
        name: t('tasks.fields.assignee'),
      });
      await list
        .getByRole('option', {
          name: new RegExp(
            `^${escapeRegExp(t('tasks.assignee.standardAgent'))}`,
          ),
        })
        .waitFor({ timeout: TIMEOUT.VISIBLE });
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
    },
    readyWhen: (page) =>
      page.getByText(t('tasks.assignee.standardAgentFooter'), { exact: true }),
    capture: (page) =>
      page.getByRole('dialog', {
        name: t('tasks.fields.assignee'),
        exact: true,
      }),
  },
  {
    // The standard agent on the Agents tab of the project that had none:
    // the Standard badge, the note that the organization's settings run it,
    // and Delete as its only action. Set up through the door the Assignee
    // option uses; `restore` deletes it again, so the project is back
    // without agents for the shot above.
    name: 'project-agents-standard',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.evaluate(
        async ({ orgId, projectId }) => {
          const ensured = await fetch(
            `/api/app/projects/${projectId}/standard-agent?orgId=${orgId}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            },
          );
          if (!ensured.ok) {
            throw new Error(`Standard agent answered ${ensured.status}`);
          }
        },
        {
          orgId: ctx.orgId,
          projectId: seededProjectId(ctx, ONBOARDING_PROJECT),
        },
      );
      await page.goto(projectRoute(ctx, '/agents', ONBOARDING_PROJECT), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByText(t('projects.agents.standard.managedNote'), {
        exact: true,
      }),
    // The row names the provider serving its model.
    sanitize: replaceRigNames,
    restore: async (page, ctx) => {
      await page.evaluate(
        async ({ orgId, projectId }) => {
          const list = await fetch(
            `/api/app/projects/${projectId}/agents?orgId=${orgId}`,
            { credentials: 'include' },
          );
          if (!list.ok) throw new Error(`Agents answered ${list.status}`);
          const body: unknown = await list.json();
          const rows =
            typeof body === 'object' && body !== null && 'agents' in body
              ? (body as { agents: { id: string; managed?: boolean }[] }).agents
              : [];
          for (const row of rows.filter((agent) => agent.managed === true)) {
            const removed = await fetch(
              `/api/app/projects/agents/${row.id}?orgId=${orgId}`,
              { method: 'DELETE', credentials: 'include' },
            );
            if (!removed.ok) {
              throw new Error(`Delete answered ${removed.status}`);
            }
          }
        },
        {
          orgId: ctx.orgId,
          projectId: seededProjectId(ctx, ONBOARDING_PROJECT),
        },
      );
    },
  },
  {
    // Settings > Skills — the built-in document skills beside the house
    // skills, each row naming who created it. Gate on a house skill's
    // creator: the table paints its chrome before its rows arrive.
    name: 'skill-library-list',
    section: 'platform',
    route: '/dashboard/:orgId/settings/skills',
    readyWhen: (page) =>
      page
        .getByRole('row')
        .filter({ has: page.getByText(DEMO_SKILLS[0].slug, { exact: true }) })
        .getByText(DEMO_OWNER.name, { exact: true }),
  },
  {
    name: 'skill-library-detail',
    section: 'platform',
    route: '/dashboard/:orgId/settings/skills',
    prepare: async (page) => {
      await page
        .getByRole('row')
        .filter({ has: page.getByText('docx', { exact: true }) })
        .click();
      await expect(
        page.getByRole('textbox', { name: t('skills.section.body') }),
      ).toBeVisible();
    },
    readyWhen: (page) =>
      page.getByRole('dialog', { name: 'docx', exact: true }),
    capture: (page) => page.getByRole('dialog', { name: 'docx', exact: true }),
    // The dialog is 85% of the viewport tall; this height keeps the
    // Organization choice and the Instructions heading below Created by in
    // the frame.
    viewport: { width: 1440, height: 1100 },
  },
  {
    // Knowledge > Knowledge entries with the seeded manual facts.
    name: 'knowledge-entries-list',
    section: 'platform',
    route: '/dashboard/:orgId/knowledge-entries',
    readyWhen: (page) =>
      page.getByText(DEMO_KNOWLEDGE_ENTRIES[0].topic).first(),
    localizedReadyWhen: (page) =>
      page.getByPlaceholder(t('knowledgeEntries.searchPlaceholder')),
  },
  {
    // Knowledge > Products — structured records an agent reads by field
    // (stock, price, category, status) instead of retrieving passages. The
    // table paints its chrome before its rows: gate on the row-count footer,
    // which renders only once the list query answered.
    name: 'knowledge-products-list',
    section: 'platform',
    route: '/dashboard/:orgId/products',
    prepare: async (page) => {
      await expect(page.locator('output').first()).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
    },
    readyWhen: (page) =>
      page.getByText(DEMO_PRODUCTS[DEMO_PRODUCTS.length - 1].name).first(),
    // Three rows need no more height than the documents list's frame.
    viewport: { width: 1440, height: 540 },
  },
  {
    // Knowledge > Websites with the Add website dialog open — domain plus
    // scan interval is the whole form.
    name: 'websites-add-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/websites',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('websites.addButton') })
        .first()
        .click();
    },
    readyWhen: (page) =>
      page.getByPlaceholder(t('websites.urlPlaceholder')).first(),
  },
  {
    // What a share RECIPIENT opens: the read-only snapshot with its byline.
    // (Sharing itself is one gesture — header ⋯ → Share copies the link —
    // so the recipient view is the surface worth photographing.)
    name: 'chat-shared-view',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await page.goto(chatThreadRoute(ctx, FEEDBACK_PROMPT), {
        waitUntil: 'domcontentloaded',
      });
      // Share opens the access dialog: pick the organization link, create it
      // when the thread is not shared yet (idempotent — an already-shared
      // thread shows its live link straight away), then take the dialog's own
      // Preview action to the snapshot.
      await page
        .getByRole('button', { name: t('chat.aria.threadActions') })
        .click();
      await page
        .getByRole('menuitem', { name: t('chat.share.button') })
        .first()
        .click();
      const dialog = page.getByRole('dialog', { name: t('chat.share.title') });
      await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await dialog
        .getByRole('radio', { name: t('chat.share.organizationLink') })
        .click();
      const createLink = dialog.getByRole('button', {
        name: t('chat.share.createLink'),
      });
      const preview = dialog.getByRole('button', {
        name: t('chat.share.preview'),
      });
      await expect(createLink.or(preview).first()).toBeVisible({
        timeout: TIMEOUT.VISIBLE,
      });
      if (await createLink.isVisible()) await createLink.click();
      await preview.click();
      await page.waitForURL(/\/chat\/shared\//, { timeout: TIMEOUT.NAV });
    },
    // The heading prefers the thread's own title; the byline ("Shared by …
    // on …") is the stable marker of the shared view in each locale.
    readyWhen: (page) =>
      page
        .getByText(labelPrefix('chat.share.byline'), { exact: false })
        .first(),
  },
  {
    // A conversation handed to a project agent: the header's Create task →
    // the project step → the task dialog drafted from the chat, with the
    // request, the way back to it, and the agent to start on it.
    name: 'chat-create-task',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await openChatHandover(page, ctx);
    },
    // Picking the agent turns the footer's verb into Create and start agent
    // — the last thing to change.
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('tasks.actions.create') })
        .getByRole('button', {
          name: t('tasks.actions.createAndStart'),
          exact: true,
        }),
    // The draft links back to the chat by the page's own origin.
    sanitize: replaceRigNames,
    capture: (page) =>
      page.getByRole('dialog', { name: t('tasks.actions.create') }),
  },
  {
    // The hand-over, live where it was asked for: the task the conversation
    // handed to an agent, above the message box, with what it is doing now.
    name: 'chat-task-tray',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await page.goto(chatThreadRoute(ctx, TASK_HANDOFF_PROMPT), {
        waitUntil: 'domcontentloaded',
      });
      await expect(composer(page)).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      // A rerun photographs the task an earlier run handed over: one row,
      // never a new task per capture.
      const handedOver = await chatTaskTray(page)
        .getByRole('listitem')
        .first()
        .waitFor({ state: 'visible', timeout: TIMEOUT.VISIBLE })
        .then(
          () => true,
          (error: unknown) => {
            console.log(
              `chat-task-tray: nothing handed over from this chat yet, handing it over now (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`,
            );
            return false;
          },
        );
      if (handedOver) return;
      const form = await openChatHandover(page, ctx);
      await form
        .getByRole('button', {
          name: t('tasks.actions.createAndStart'),
          exact: true,
        })
        .click();
      await expect(form).toBeHidden({ timeout: TIMEOUT.VISIBLE });
    },
    // The run settles the task into review: the row's last state.
    readyWhen: (page) =>
      chatTaskTray(page)
        .getByRole('listitem')
        .filter({ hasText: t('chat.taskTray.ready') }),
    capture: (page) =>
      // The tray with the message box it sits on — the innermost element
      // holding both (document order puts the outermost ancestor first).
      page
        .locator('div')
        .filter({ has: chatTaskTray(page) })
        .filter({ has: composer(page) })
        .last(),
    // That element spans the chat column, and both sit centred in it: a
    // column as wide as the message box keeps the crop to them, so the
    // tray's text stays legible at the page's width.
    viewport: { width: 1140, height: 800 },
  },
  {
    // Arena Mode: the same prompt streamed into two model columns.
    name: 'chat-arena-split',
    section: 'platform',
    route: FRESH_CHAT_ROUTE,
    prepare: async (page) => {
      // Wait for the chat surface to hydrate FIRST. A fill that lands before
      // React attaches writes the DOM value but never the component state, so
      // Send stays disabled, Enter sends nothing, and the shot dies waiting for
      // a reply that was never requested.
      await page
        .getByText('Help me write a clear, professional email')
        .first()
        .waitFor({ timeout: 30_000 });
      // Arena Mode is an entry in the composer's "+" mode menu.
      await page
        .getByRole('button', { name: t('composer.openMenu') })
        .first()
        .click();
      // Modes toggle, not a plain action — the entry is a menuitemcheckbox,
      // and a checkbox item keeps its menu OPEN after toggling. The open
      // menu is modal, so the page behind it is aria-hidden and the composer
      // textbox is unreachable until the menu is dismissed.
      await page
        .getByRole('menuitemcheckbox', { name: t('chat.arena.label') })
        .first()
        .click();
      await page.keyboard.press('Escape');
      const input = page.getByRole('textbox', {
        name: t('chat.aria.chatInput'),
      });
      await input.click();
      await input.fill(
        'Draft a launch checklist for the website relaunch project',
      );
      await page.keyboard.press('Enter');
      // Both columns stream the same scripted reply — wait for the LAST
      // sentence in the second column so the shot shows finished replies.
      await page
        .getByText('launch-blocking ones')
        .nth(1)
        .waitFor({ timeout: 60_000 });
    },
    readyWhen: (page) => page.getByText('launch-blocking ones').nth(1),
  },
  {
    // The empty new-chat screen with the Assistant's conversation starters.
    name: 'chat-starters-empty',
    section: 'platform',
    route: FRESH_CHAT_ROUTE,
    // The starters render immediately; the picker's model label does not
    // (same composer-options race as chat-composer) — gate on the label.
    readyWhen: (page) =>
      page
        .getByRole('button', { name: t('chat.picker.ariaLabel') })
        .filter({ hasNotText: t('chat.modelSelector.noModelsAvailable') }),
  },
  {
    // Home's Inbox view beside an open customer conversation: the seeded
    // helpdesk mirror, newest first. Choose the view and open the
    // conversation from the list as a reader does. The reply editor loads
    // lazily behind a skeleton, so it is the last thing to settle.
    name: 'home-inbox',
    section: 'platform',
    route: '/dashboard/:orgId/conversations/open',
    prepare: async (page) => {
      await inboxView(page).click();
      await page.getByText(DEMO_INBOX[0].subject).first().click();
      await expect(
        page
          .getByText(
            DEMO_INBOX[0].messages[DEMO_INBOX[0].messages.length - 1].content,
          )
          .first(),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
        timeout: TIMEOUT.FIRST_PAINT,
      });
      // The click leaves the pointer on the row, which swaps its initials
      // for the selection checkbox; rest it on the empty thread instead.
      await page.mouse.move(1000, 560);
    },
    readyWhen: (page) =>
      page.getByLabel(t('conversations.messagePlaceholder')).first(),
    localizedReadyWhen: inboxView,
  },
  {
    // Show the indexed uploads through the real filters, keeping unrelated
    // manual-review records out of the introductory library view. The active
    // filter indicator remains visible; no rows or statuses are changed for capture.
    name: 'documents-list',
    section: 'get-started',
    viewport: { width: 1440, height: 540 },
    route: '/dashboard/:orgId/documents',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('common.labels.filter'), exact: true })
        .click();
      const filters = page.getByRole('dialog');
      await filters
        .getByRole('button', {
          name: t('tables.headers.ragStatus'),
          exact: true,
        })
        .click();
      await filters
        .getByRole('checkbox', {
          name: t('documents.filter.ragStatus.indexed'),
          exact: true,
        })
        .check();
      await filters
        .getByRole('button', { name: t('tables.headers.source'), exact: true })
        .click();
      await filters
        .getByRole('checkbox', {
          name: t('documents.filter.source.upload'),
          exact: true,
        })
        .check();
      await page.keyboard.press('Escape');
      await expect(filters).not.toBeVisible();
    },
    readyWhen: (page) =>
      page
        .getByText(t('documents.rag.status.indexed'), { exact: true })
        .nth(DEMO_DOCUMENTS.length - 1),
  },
  {
    name: 'document-indexing-unsupported',
    section: 'platform',
    route: '/dashboard/:orgId/documents',
    prepare: async (page) => {
      const row = page.getByRole('row').filter({
        has: page.getByText(DEMO_EMPTY_DOCUMENT.fileName, { exact: true }),
      });
      await expect(
        row.getByText(t('documents.rag.status.unsupported'), { exact: true }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await row
        .getByRole('button', {
          name: t('documents.rag.dialog.unsupported.title'),
        })
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('dialog', {
        name: t('documents.rag.dialog.unsupported.title'),
      }),
    capture: (page) =>
      page.getByRole('dialog', {
        name: t('documents.rag.dialog.unsupported.title'),
      }),
  },
  {
    // A controlled record's one-file replacement dialog. The prepare step
    // accepts an uncontrolled row, an existing draft, or an approved row; the
    // approved case opens Replace directly without creating a revision first.
    name: 'controlled-document-replace-file',
    section: 'platform',
    route: '/dashboard/:orgId/documents',
    prepare: async (page) => {
      const row = page
        .getByRole('row')
        .filter({ hasText: DEMO_DOCUMENTS[0].fileName })
        .first();
      await expect(row).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      const openRowMenu = async () => {
        await row
          .getByRole('button', { name: t('common.actions.openMenu') })
          .click();
      };

      await openRowMenu();
      const markControlled = page.getByRole('menuitem', {
        name: t('documents.record.actions.markControlled'),
      });
      const replaceFile = page.getByRole('menuitem', {
        name: t('documents.record.actions.replaceFile'),
      });
      await expect(markControlled.or(replaceFile)).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      if (await markControlled.isVisible().catch(() => false)) {
        await markControlled.click();
        const draftBadge = t('documents.record.badge')
          .replace('{version}', '1')
          .replace('{state}', t('documents.record.state.draft'));
        await expect(row.getByText(draftBadge)).toBeVisible({
          timeout: TIMEOUT.FIRST_PAINT,
        });
        await openRowMenu();
      }
      await expect(replaceFile).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await replaceFile.click();
    },
    readyWhen: (page) =>
      page.getByRole('dialog', {
        name: t('documents.record.replace.title'),
      }),
    capture: (page) =>
      page.getByRole('dialog', {
        name: t('documents.record.replace.title'),
      }),
  },
  {
    // The create-organization wizard's workspace step (what a fresh admin
    // sees) — reachable for an existing user without creating anything.
    name: 'org-create-wizard',
    section: 'get-started',
    route: '/dashboard/create-organization',
    // Type the workspace name (never submit — that would mint a second org and
    // collide on the slug). An empty field with a disabled Next button teaches
    // nothing; a filled one shows the step as a reader will actually leave it.
    prepare: async (page) => {
      await page
        .getByLabel(t('settings.organization.organizationName'))
        .fill(DEMO_ORG_NAME);
    },
    readyWhen: (page) =>
      page.getByLabel(t('settings.organization.organizationName')),
  },
  {
    // Settings > Members — the members table with its Add member action.
    // (Members moved off the Organization page onto their own settings page;
    // the image keeps its name so every page embedding it keeps resolving.)
    // The owner's row is the honest "table resolved" marker.
    name: 'settings-organization-members',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/members',
    readyWhen: (page) =>
      page.getByRole('row').filter({ hasText: DEMO_OWNER.name }).first(),
  },
  {
    // Settings > Teams — the teams table with its create action. A fresh
    // demo org has no teams yet, so this shows the empty-state table.
    name: 'settings-teams',
    section: 'platform',
    route: '/dashboard/:orgId/settings/teams',
    readyWhen: (page) =>
      page
        .getByRole('button', { name: t('settings.teams.createTeam') })
        .first(),
  },
  {
    // Settings > Branding — the logo, favicon, and accent-colour controls the
    // org shows the rest of the workspace.
    name: 'settings-branding',
    section: 'platform',
    route: '/dashboard/:orgId/settings/branding',
    readyWhen: (page) =>
      page.getByText(t('settings.branding.accentColor')).first(),
  },
  {
    // Settings > AI providers — the credentials table with the seeded row
    // (the shipped vendor catalog is step one of Add credential). The section
    // chrome paints before the rows do, so the seeded ROW is the honest
    // "loaded" marker — the same lesson as the API keys shot.
    name: 'settings-providers',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/providers',
    // Until the vendor catalog answers, the row names its provider by the
    // bare slug and carries no tag: wait for the display name.
    readyWhen: (page) =>
      page
        .getByRole('row')
        .filter({ hasText: DEMO_PROVIDER_CREDENTIAL })
        .filter({ hasText: MOCK_PROVIDER_DISPLAY_NAME })
        .first(),
    sanitize: async (page) => {
      await replaceRigNames(page);
      // The rig defines the mock inside the organization, so its row carries
      // the Custom tag; the shipped vendor it stands in for carries none.
      // Remove the whole tag, which the badge titles with its label: its text
      // alone would leave an empty pill behind.
      await page
        .getByRole('row')
        .filter({ hasText: DEMO_PROVIDER_CREDENTIAL })
        .getByTitle(t('settings.providers.custom.badge'), { exact: true })
        .evaluateAll((badges) => {
          for (const badge of badges) badge.remove();
        });
    },
  },
  {
    // Show the choices before creating a key; never capture its one-time secret.
    name: 'settings-api-keys',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/api/rest',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('settings.apiKeys.createKey') })
        .click();
      await page
        .getByRole('dialog', { name: t('settings.apiKeys.createKey') })
        .getByLabel(t('settings.apiKeys.form.name'))
        .fill('Project reporting');
    },
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('settings.apiKeys.createKey') })
        .getByLabel(t('settings.apiKeys.form.name')),
    capture: (page) =>
      page.getByRole('dialog', { name: t('settings.apiKeys.createKey') }),
  },
  {
    // An Owner's key for the organization itself: whom the key belongs to,
    // and the role it acts with. Never capture the one-time secret.
    name: 'settings-api-keys-organization',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/rest',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('settings.apiKeys.createKey') })
        .click();
      const dialog = page.getByRole('dialog', {
        name: t('settings.apiKeys.createKey'),
      });
      await dialog
        .getByLabel(t('settings.apiKeys.form.name'))
        .fill('Nightly export');
      await dialog
        .getByRole('combobox', { name: t('settings.apiKeys.form.owner') })
        .click();
      await page
        .getByRole('option', {
          name: t('settings.apiKeys.form.ownerOptions.organization'),
        })
        .click();
      await dialog
        .getByRole('combobox', { name: t('settings.apiKeys.form.role') })
        .click();
      await page.getByRole('option', { name: t('roles.developer') }).click();
    },
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('settings.apiKeys.createKey') })
        .getByRole('combobox', { name: t('settings.apiKeys.form.role') })
        .filter({ hasText: t('roles.developer') }),
    capture: (page) =>
      page.getByRole('dialog', { name: t('settings.apiKeys.createKey') }),
  },
  {
    // Settings > API > Models — the two base URLs, the models the member may
    // call and the tool setups. Gate on a listed model id: the list arrives
    // after the page chrome.
    name: 'settings-api-models',
    section: 'develop',
    route: '/dashboard/:orgId/settings/api/models',
    readyWhen: (page) =>
      page
        .getByText(`${MOCK_PROVIDER_SLUG}/anthropic/claude-sonnet-4.6`)
        .first(),
    sanitize: replaceRigNames,
  },
  {
    // Four shipped triage examples, found with the real list search, show
    // their versions and deployment state beside Create automation.
    name: 'automations-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/automations',
    prepare: showTriageAutomationExamples,
    readyWhen: (page) =>
      page.getByText('gmail-triage-inbox', { exact: true }).first(),
  },
  {
    // The Upload package dialog — file drop zone and the Install into picker.
    // Its trigger is an item of the Create automation menu.
    name: 'automations-upload-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/automations',
    prepare: async (page) => {
      await showTriageAutomationExamples(page);
      await page
        .getByRole('button', { name: t('automations.list.createButton') })
        .click();
      await page
        .getByRole('menuitem', { name: t('automations.upload.trigger') })
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('heading', { name: t('automations.upload.title') }),
  },
  {
    // The Editor tab — the saved version laid out between Start (the
    // schedule in words, the run input's fields) and End: the condition in
    // words above Triage, the Continues on error chip on Propose, the frames
    // of the nodes that run once per item, and the node inspector beside the
    // canvas with the version and run actions in the tab strip.
    name: 'automation-editor-canvas',
    section: 'platform',
    // A pack's automation is NAMED after its path with the separator
    // flattened (`gmail/triage-inbox` → `gmail-triage-inbox`, see
    // lib/automations/packs), so the route param is that name — the `__`
    // codec is only for names that carry a real `/`.
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    // Select the LLM step so the inspector shows a node's fields instead of
    // its "select a node" hint — the frame then teaches both halves at once.
    // A node box is a button carrying `data-flow-node=<id>` (the same
    // attribute the inspector's Close restores focus to).
    prepare: async (page) => {
      await expect(
        page.getByRole('link', {
          name: t('automations.navigation.editor'),
          exact: true,
        }),
      ).toHaveAttribute('aria-current', 'page');
      await settleAutomationEditor(page);
      await openAutomationNode(page, 'triage');
    },
    // The inspector renders the selected node's Input field only once the
    // node-type catalog has answered, and the field is a code editor that
    // loads on first use — gate on the loaded editor so the panel is never
    // captured mid-load. (Start's face also reads "Input", as plain text.)
    readyWhen: (page) =>
      page.getByRole('textbox', {
        name: t('automations.editor.fields.input'),
        exact: true,
      }),
  },
  {
    // The Editor's Problems list under the canvas: a draft whose triage
    // prompt reads a node that does not exist — the node's error chip, the
    // reason under the Prompt field, Save waiting with its reason, and the
    // list's row with its location and fix.
    name: 'automation-editor-problems',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      await openAutomationNode(page, 'triage');
      const prompt = page.getByRole('textbox', {
        name: t('automations.editor.fields.prompt'),
        exact: true,
      });
      await prompt.click();
      await prompt.press('ControlOrMeta+End');
      // The Prompt is a code editor: `{{` closes itself with the caret
      // inside, and the final `}}` steps over the closing braces, so the
      // typed text ends as one template.
      await prompt.pressSequentially(' {{ nodes.nope.output }}');
      // The button's name opens with the panel's title ("Problems: 1 error")
      // once the check of the draft has settled.
      const problems = page.getByRole('button', {
        name: new RegExp(
          `^${escapeRegExp(t('automations.problems.title'))}: 1 `,
        ),
      });
      await problems.click({ timeout: 30_000 });
    },
    readyWhen: (page) =>
      page
        .getByRole('region', {
          name: t('automations.problems.title'),
          exact: true,
        })
        .getByRole('listitem')
        .first(),
  },
  {
    // Possible paths open beside the canvas with Path 2 pinned: the nodes
    // off that path dashed with the reason they don't run, End marking the
    // outputs that stay empty on it, and the nodes whose failure ends the
    // run listed under the paths.
    name: 'automation-editor-paths',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      // The button counts the paths ("3 paths"); find it by its words.
      await page
        .getByRole('button', {
          name: pluralPattern(t('automations.paths.button')),
        })
        .click();
      await page.locator('[data-flow-path-row="path:2"]').click();
    },
    readyWhen: (page) =>
      page.locator('[data-flow-path-row="path:2"][aria-pressed="true"]'),
  },
  {
    // A Prompt in the code editor: `{{` typed on its last line became a
    // template with the caret inside, and after `nodes.` the completion
    // list offers the nodes that run earlier, with their shapes.
    name: 'automation-editor-code',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      await openAutomationNode(page, 'triage');
      const prompt = page.getByRole('textbox', {
        name: t('automations.editor.fields.prompt'),
        exact: true,
      });
      await prompt.click();
      // The prompt ends with a line break, so its end is an empty line.
      await prompt.press('ControlOrMeta+End');
      await prompt.pressSequentially('{{nodes.');
    },
    // Inbox is the one node that runs before Triage.
    readyWhen: (page) =>
      page
        .getByRole('listbox')
        .getByRole('option')
        .filter({ hasText: 'inbox' })
        .first(),
  },
  {
    // A node's Shape tab: what Triage receives and returns, where the
    // returned shape comes from (its output schema), and the nodes that read
    // it. The shapes come from the check of the draft.
    name: 'automation-editor-node-shape',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      await openAutomationNode(page, 'triage');
      await page
        .getByRole('tab', {
          name: t('automations.editor.inspector.tabs.shape'),
          exact: true,
        })
        .click();
      await expect(
        page.getByText(t('automations.editor.shape.checking'), {
          exact: true,
        }),
      ).toHaveCount(0, { timeout: TIMEOUT.FIRST_PAINT });
    },
    readyWhen: (page) =>
      page.getByRole('heading', {
        name: t('automations.editor.shape.returns'),
        exact: true,
      }),
  },
  {
    // Start's inspector: the trigger in words with Change in General, the
    // run input's fields as a tree, and the JSON Schema behind them in the
    // code editor.
    name: 'automation-editor-start',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      await openAutomationNode(page, '__start');
      await expect(
        page.getByRole('link', {
          name: t('automations.editor.start.editTrigger'),
          exact: true,
        }),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    },
    // Start's schema field carries the run dialog's "Input schema" label.
    readyWhen: (page) =>
      page.getByRole('textbox', {
        name: t('automations.detail.runInput.schema'),
        exact: true,
      }),
  },
  {
    // The Source view: the whole document as highlighted YAML with line
    // numbers and fold markers, Copy YAML and Download YAML, and the line
    // saying how to change it.
    name: 'automation-editor-source',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: async (page) => {
      await settleAutomationEditor(page);
      await page
        .getByRole('radio', {
          name: t('automations.canvas.view.source'),
          exact: true,
        })
        .click();
    },
    // The source is a read-only code editor that loads on first use.
    readyWhen: (page) =>
      page.getByRole('textbox', {
        name: t('automations.source.ariaLabel'),
        exact: true,
      }),
  },
  {
    // The Editor on a phone: compact navigation, the canvas filling the
    // height between Start and End, and the run and save controls in the
    // toolbar at its foot.
    name: 'automation-editor-canvas-mobile',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/editor',
    prepare: settleAutomationEditor,
    readyWhen: (page) => laidOutAutomationCanvas(page),
    viewport: { width: 390, height: 844 },
  },
  {
    // An automation's General tab — its trigger (the pack's schedule: cron,
    // timezone, enabled) above the projects it is bound to. The form paints
    // before the trigger query answers, so gate on the cron field holding
    // the pack's expression. The tab is short; trim the empty frame below.
    name: 'automation-general-trigger',
    section: 'platform',
    route: '/dashboard/:orgId/automations/gmail-triage-inbox/general',
    readyWhen: (page) =>
      page.getByRole('textbox', {
        name: t('automations.trigger.cronLabel'),
        exact: true,
      }),
    prepare: async (page) => {
      await expect(
        page.getByRole('textbox', {
          name: t('automations.trigger.cronLabel'),
          exact: true,
        }),
      ).not.toHaveValue('', { timeout: TIMEOUT.FIRST_PAINT });
    },
    viewport: { width: 1440, height: 640 },
  },
  {
    // The Test run dialog: the run input as JSON in the code editor, and the
    // input schema expanded as a tree of fields with their kinds.
    name: 'automation-run-input',
    section: 'platform',
    route: `/dashboard/:orgId/automations/${DEMO_TEST_RUN.automation}/editor`,
    prepare: async (page) => {
      // The run button can paint before the saved document has loaded. Wait
      // for its version picker so Test run has the saved input schema.
      await expect(
        page.getByRole('button', {
          name: t('automations.detail.versionSelect'),
          exact: true,
        }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await page
        .getByRole('button', {
          name: t('automations.detail.runMock'),
          exact: true,
        })
        .click();
      const dialog = page.getByRole('dialog', {
        name: t('automations.detail.runMock'),
        exact: true,
      });
      await dialog
        .getByRole('textbox', { name: t('automations.detail.runInput.label') })
        .fill(JSON.stringify(DEMO_TEST_RUN.input, null, 2));
      await dialog
        .getByText(t('automations.detail.runInput.schema'), { exact: true })
        .click();
      await expect(
        dialog.getByRole('button', {
          name: t('automations.detail.runMock'),
          exact: true,
        }),
      ).toBeEnabled();
    },
    readyWhen: (page) =>
      page.getByRole('dialog', {
        name: t('automations.detail.runMock'),
        exact: true,
      }),
    capture: (page) =>
      page.getByRole('dialog', {
        name: t('automations.detail.runMock'),
        exact: true,
      }),
  },
  {
    // The seeded test run of the GitHub triage pack, opened from the Runs
    // tab as a reader does: status, mode, version, starter and timing above
    // the workflow with every node's result; the effects list starts below
    // the fold (the canvas grows with the window). The canvas draws its
    // boxes before the trace arrives — gate on the last node's run state.
    name: 'automation-run-detail',
    section: 'platform',
    route: `/dashboard/:orgId/automations/${DEMO_TEST_RUN.automation}/runs`,
    prepare: async (page) => {
      await page.locator('a[href*="/runs/"]').first().click();
    },
    readyWhen: (page) =>
      page.locator('[data-flow-node="report"][data-flow-state="succeeded"]'),
    localizedReadyWhen: (page) =>
      page.getByRole('heading', {
        name: labelStart(labelPrefix('automations.runs.heading')),
      }),
  },
  {
    // The seeded failed test run of the invoice digest: the node that failed
    // in view, framed red with its error line, the way the run took to it
    // brought forward while the rest steps back, and End saying where the
    // run failed.
    name: 'automation-run-failed',
    section: 'platform',
    route: `/dashboard/:orgId/automations/${DEMO_FAILED_RUN.automation}/runs`,
    prepare: async (page) => {
      await page.locator('a[href*="/runs/"]').first().click();
    },
    readyWhen: (page) =>
      page.locator(
        `[data-flow-node="${DEMO_FAILED_RUN.failsAt}"][data-flow-state="failed"]`,
      ),
  },
  {
    // Settings > Connectors with Add credential open on its first step — the
    // shipped connector catalog. The page itself is the credentials table
    // (the seeded Tavily key), so the catalog is what a reader picks from.
    name: 'connectors-add-credential',
    section: 'platform',
    route: '/dashboard/:orgId/settings/connectors',
    prepare: async (page) => {
      // Let the table resolve first: the Add button paints before the rows,
      // and the dialog lists configured connectors ahead of the rest.
      await expect(
        page
          .getByRole('row')
          .filter({ hasText: 'Tavily' })
          .first()
          .or(page.getByText(t('emptyStates.connectors.title')).first())
          .first(),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await page
        .getByRole('button', { name: t('settings.credentials.addCredential') })
        .first()
        .click();
    },
    // The catalog renders from the connectors query the table already holds,
    // so a vendor card is the honest "dialog is up" marker.
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('settings.credentials.catalog.title') })
        .getByRole('button', { name: /Confluence/ })
        .first(),
  },
  {
    // Settings > API > MCP — outbound MCP-server management is retired, so the
    // endpoint (plus the engine method list) is the whole MCP surface. It is an
    // API surface, not one of the per-vendor connectors, and has its own page.
    name: 'settings-mcp-endpoint',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/mcp',
    // Gate on the Organization slug row, which renders only once the org query
    // resolves — the example request embeds that slug, so waiting for it keeps
    // the field from re-rendering (and un-sanitizing its origin) after
    // `sanitize` runs.
    readyWhen: (page) =>
      page.getByText(t('settings.mcpEndpoint.orgSlug.title')),
    // The endpoint URL and the example request print the rig's origin.
    sanitize: replaceRigNames,
  },
  {
    // Settings > API > WebDAV — connection details and the app-password
    // generator.
    name: 'settings-webdav',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/webdav',
    prepare: async (page) => {
      // Wait for the organization-derived URL, not the static section title;
      // a late query render would replace the sanitized origin again.
      await expect(
        page.getByText(/\/dav\/[^/]+\/documents\//).first(),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    },
    readyWhen: (page) => page.getByText(DEMO_WEBDAV_RETIRED_LABEL),
    // The connection URL shows the capture rig's localhost origin.
    sanitize: replaceRigNames,
  },
  {
    // Settings > Account — the sign-in methods a member manages for
    // themselves: the password, two-factor authentication and passkeys, with
    // one passkey registered. `prepare` registers it through the real dialog
    // against a virtual authenticator (the WebAuthn ceremony a browser runs),
    // confirming the password first when the stored session is older than a
    // day. The passkey stays; a later run finds it listed and skips ahead.
    name: 'settings-account-security',
    section: 'platform',
    route: '/dashboard/:orgId/settings/account',
    // Tall enough for the whole page, Profile down to Passkeys.
    viewport: { width: 1440, height: 1260 },
    prepare: async (page) => {
      const passkeys = page.getByRole('region', {
        name: t('twoFactor.passkeys.title'),
      });
      const add = passkeys.getByRole('button', {
        name: t('twoFactor.passkeys.addButton'),
      });
      const listed = passkeys.getByRole('cell', { name: DEMO_PASSKEY_NAME });
      // The list reads after the section paints: wait for its answer.
      await expect(
        listed.or(passkeys.getByText(t('twoFactor.passkeys.empty'))),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      if (await listed.isVisible()) return;

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await add.click();
      const dialog = page.getByRole('dialog', {
        name: t('twoFactor.passkeys.addButton'),
      });
      const password = dialog.getByRole('textbox', {
        name: t('twoFactor.confirmPassword.label'),
        exact: true,
      });
      const name = dialog.getByRole('textbox', {
        name: t('twoFactor.passkeys.nameLabel'),
      });
      await expect(password.or(name)).toBeVisible();
      if (await password.isVisible()) {
        await password.fill(DEMO_OWNER.password);
        await dialog
          .getByRole('button', { name: t('twoFactor.confirmPassword.submit') })
          .click();
      }
      await name.fill(DEMO_PASSKEY_NAME);
      await dialog
        .getByRole('button', { name: t('twoFactor.passkeys.addButton') })
        .click();
      await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    },
    readyWhen: (page) =>
      page
        .getByRole('region', { name: t('twoFactor.passkeys.title') })
        .getByRole('cell', { name: DEMO_PASSKEY_NAME }),
  },
  {
    // Settings > Preferences — the custom-instructions section with its
    // toggle over the org default: the per-user layer the chat prompt reads.
    name: 'settings-preferences',
    section: 'platform',
    route: '/dashboard/:orgId/settings/personalization',
    // Gate on the instructions field: it exists only once the preferences
    // read has answered AND the feature is on (the seed turns it on and
    // writes the text), so its presence is the page's settled state.
    readyWhen: (page) =>
      page.getByRole('textbox', {
        name: t('personalization.page.customInstructions.title'),
      }),
  },
  {
    // Settings > Usage — the reader's standing under every budget cap that
    // binds them (the demo org's default and organization rules) and their
    // storage quota. The two reads settle independently: the shared section
    // paints only once the budget read answers, then gate on the storage
    // meter, which waits on the upload-usage read.
    name: 'settings-usage',
    section: 'platform',
    // Taller than the default so the Storage section clears the fold under
    // the owner's six budget rows.
    viewport: { width: 1440, height: 1024 },
    route: '/dashboard/:orgId/settings/usage',
    prepare: async (page) => {
      await expect(
        page.getByRole('heading', { name: t('settings.usage.shared.title') }),
      ).toBeVisible({ timeout: TIMEOUT.PERSIST });
    },
    readyWhen: (page) =>
      page.getByRole('progressbar', {
        name: new RegExp(`^${t('settings.usage.storage.label')}: `),
      }),
  },
  {
    // Settings > Metrics > Usage — totals, the token chart and the top
    // assistants the seeded chats produced. The page renders its own
    // skeleton (aria-busy, masked headings) until its one query answers.
    name: 'metrics-usage',
    section: 'platform',
    route: '/dashboard/:orgId/settings/metrics/usage',
    prepare: async (page) => {
      await expect(
        page.getByRole('heading', {
          name: t('analytics.usage.title'),
          exact: true,
        }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
        timeout: TIMEOUT.FIRST_PAINT,
      });
    },
    readyWhen: (page) =>
      page.getByRole('heading', {
        name: t('analytics.usage.title'),
        exact: true,
      }),
  },
  {
    // Settings > Metrics > Chat health — turns, error and blocked rates, and
    // the per-model breakdown of the seeded chats. Its sections load
    // separately; wait until none is still busy.
    name: 'metrics-chat-health',
    section: 'platform',
    route: '/dashboard/:orgId/settings/metrics/chat-health',
    prepare: async (page) => {
      await expect(
        page.getByRole('heading', {
          name: t('analytics.chatHealth.title'),
          exact: true,
        }),
      ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, {
        timeout: TIMEOUT.FIRST_PAINT,
      });
    },
    readyWhen: (page) =>
      page.getByRole('heading', {
        name: t('analytics.chatHealth.title'),
        exact: true,
      }),
  },
  {
    // The independent server-audio selection on Models. Crop to this section
    // so its current pick remains readable at normal documentation width.
    // Wait for the resolved status, not the static title above a skeleton.
    name: 'governance-content-models',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    // The mock gateway lists a speech-to-text model, so Automatic resolves;
    // the "no model available" warning is a broken stack, never the shot.
    readyWhen: (page) => {
      return page
        .getByText(labelPrefix('governance.transcriptionModel.currentModel'))
        .first();
    },
    // The model in use names the provider serving it.
    sanitize: replaceRigNames,
    capture: (page) =>
      page.getByRole('region', {
        name: t('governance.transcriptionModel.title'),
        exact: true,
      }),
  },
  {
    // Governance > Models — image generation switched on with a pinned image
    // model (the demo organization's fixture pins the mock gateway's image
    // model). Gate on the resolved sentence, not the static title above a
    // skeleton; the frame names the vendor a customer's page names.
    name: 'governance-image-generation',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    readyWhen: (page) =>
      imageGenerationSection(page).getByText(
        labelPrefix('governance.imageGeneration.currentModel.pinned'),
      ),
    sanitize: replaceRigNames,
    capture: (page) => imageGenerationSection(page),
  },
  {
    // Governance > Models — the organization's standard agent as a new
    // organization has it: on, its agent type and model automatic. The line
    // naming what it runs on for the viewer lands last, once the policy and
    // the viewer's model choice have both answered.
    name: 'governance-standard-agent',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    readyWhen: (page) =>
      standardAgentSection(page).getByText(
        labelPrefix('governance.standardAgent.current'),
      ),
    sanitize: replaceRigNames,
    capture: (page) => standardAgentSection(page),
  },
  {
    // Governance > Models — the model endpoints for API keys, switched on in
    // the demo organization's model access policy. The switch reads on only
    // once the policy has loaded.
    name: 'governance-model-endpoints',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    readyWhen: (page) =>
      modelEndpointsSection(page).getByRole('switch', {
        name: t('governance.modelAccess.modelApi.enabled'),
        checked: true,
      }),
    capture: (page) => modelEndpointsSection(page),
  },
  {
    // Governance > Policies & Limits — budget rules, upload/retention policy,
    // and the feature caps that protect the org. Sandbox limits have their
    // own settings surface next to runtime capacity.
    name: 'governance-policies-limits',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/policies-limits',
    readyWhen: (page) => page.getByText(t('governance.budgets.title')).first(),
    // Land the fold ON a section boundary (measured), not mid-row: any height is
    // a cut somewhere, so cut where the page already has a seam.
    viewport: { width: 1440, height: 1530 },
  },
  {
    // A budget rule that caps one project: the Project scope, its picker with
    // the project chosen, and a monthly cost cap, with the warning threshold
    // that warns everyone chatting in the project left empty. Captured before
    // it is confirmed, so the demo organization's rules stay as seeded.
    name: 'governance-budget-project-rule',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/policies-limits',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('governance.budgets.addRule') })
        .first()
        .click();
      const dialog = budgetRuleDialog(page);
      await dialog
        .getByRole('combobox', { name: t('governance.budgets.scope') })
        .click();
      await page
        .getByRole('option', {
          name: t('governance.budgets.scopeLabels.project'),
          exact: true,
        })
        .click();
      await dialog.getByLabel(t('governance.budgets.costLimitUsd')).fill('200');
      // The project last: its picker keeps focus without a keyboard ring.
      await dialog
        .getByRole('button', { name: t('governance.budgets.project') })
        .click();
      await page
        .getByRole('option', { name: RELAUNCH_PROJECT, exact: true })
        .click();
    },
    readyWhen: (page) =>
      budgetRuleDialog(page)
        .getByRole('button', { name: t('governance.budgets.project') })
        .filter({ hasText: RELAUNCH_PROJECT }),
    capture: (page) => budgetRuleDialog(page),
  },
  {
    // Governance > Policies & Limits — who may share a skill with the whole
    // organization. The section renders inside a busy skeleton until the
    // policy loads, so wait that out before the crop.
    name: 'governance-skill-sharing',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/policies-limits',
    prepare: async (page) => {
      await expect(skillSharingSection(page)).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
      await expect(
        page.getByRole('status', {
          name: t('governance.skillSharing.title'),
          exact: true,
        }),
      ).toHaveCount(0, { timeout: TIMEOUT.FIRST_PAINT });
    },
    readyWhen: (page) =>
      skillSharingSection(page).getByRole('combobox', {
        name: t('governance.skillSharing.label'),
        exact: true,
      }),
    capture: (page) => skillSharingSection(page),
  },
  {
    // Governance > Policies & Limits — the chat confidentiality notice
    // switched on, its English text saved with a German translation, and
    // French left untranslated so its tab shows the pill. The notice goes
    // back off afterwards: left on, it would appear under every chat shot's
    // composer.
    name: 'governance-confidentiality-notice',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/policies-limits',
    prepare: async (page) => {
      const section = dataNoticeSection(page);
      await section.scrollIntoViewIfNeeded();
      await setDataNotice(page, true);
      const texts = [
        [t('languageSwitcher.locales.en'), DEMO_DATA_NOTICE.en],
        [t('languageSwitcher.locales.de'), DEMO_DATA_NOTICE.de],
        [t('languageSwitcher.locales.fr'), ''],
      ] as const;
      let changed = false;
      for (const [language, text] of texts) {
        await section
          .getByRole('tab', { name: new RegExp(`^${language}`) })
          .click();
        const field = section.getByRole('textbox', {
          // The e2e resolver does not interpolate; fill the one placeholder.
          name: t('governance.dataNotice.textLabel').replace(
            '{language}',
            language,
          ),
          exact: true,
        });
        if ((await field.inputValue()) !== text) {
          await field.fill(text);
          changed = true;
        }
      }
      if (changed) {
        const save = page.getByRole('button', {
          name: t('common.actions.save'),
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        await expect(
          page.getByRole('button', {
            name: t('common.actions.saved'),
            exact: true,
          }),
        ).toBeVisible();
      }
      await section
        .getByRole('tab', {
          name: new RegExp(`^${t('languageSwitcher.locales.en')}`),
        })
        .click();
      await section.scrollIntoViewIfNeeded();
    },
    readyWhen: (page) =>
      dataNoticeSection(page).getByRole('tab', {
        name: new RegExp(
          `^${t('languageSwitcher.locales.fr')}.*${t('common.localeTabs.untranslated')}`,
        ),
      }),
    capture: (page) => dataNoticeSection(page),
    restore: (page) => setDataNotice(page, false),
  },
  {
    name: 'settings-sandboxes',
    section: 'platform',
    route: '/dashboard/:orgId/settings/sandboxes',
    prepare: async (page) => {
      const fields = [
        ['project', DEFAULT_SANDBOX_QUOTA.maxSessionsPerOrg],
        ['workflow', DEFAULT_SANDBOX_QUOTA.maxWorkflowSessionsPerOrg],
        ['render', DEFAULT_SANDBOX_QUOTA.maxRenderSessionsPerOrg],
      ] as const;
      // The dedicated docs org may still hold older saved limits. Set the
      // current defaults through the real editor, so the capture shows the
      // persisted total rather than an unsaved example or fabricated pixels.
      let changed = false;
      for (const [budget, limit] of fields) {
        const input = page.getByRole('spinbutton', {
          name: t(`sandboxes.quota.budgets.${budget}`),
          exact: true,
        });
        await expect(input).toBeEnabled();
        await expect(input).not.toHaveValue('');
        if ((await input.inputValue()) !== String(limit)) {
          await input.fill(String(limit));
          changed = true;
        }
      }
      if (changed) {
        const save = page.getByRole('button', {
          name: t('common.actions.save'),
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        await expect(
          page.getByRole('button', {
            name: t('common.actions.saved'),
            exact: true,
          }),
        ).toBeVisible();
        await page.reload();
        for (const [budget, limit] of fields) {
          await expect(
            page.getByRole('spinbutton', {
              name: t(`sandboxes.quota.budgets.${budget}`),
              exact: true,
            }),
          ).toHaveValue(String(limit));
        }
      }
      await expect(
        page.getByRole('status', {
          name: t('sandboxes.limits.total'),
          exact: true,
        }),
      ).toHaveText(
        new RegExp(`^${sandboxQuotaTotal(DEFAULT_SANDBOX_QUOTA)} / \\d+$`),
      );
    },
    readyWhen: (page) =>
      page.getByRole('region', {
        name: t('sandboxes.limits.title'),
        exact: true,
      }),
    capture: (page) =>
      page.getByRole('region', {
        name: t('sandboxes.limits.title'),
        exact: true,
      }),
  },
  {
    name: 'sandbox-workspace-cleanup',
    section: 'platform',
    route: '/dashboard/:orgId/settings/sandboxes',
    prepare: async (page) => {
      // The shot shows the rule every organization starts with: unused
      // workspaces deleted after the default number of days. An earlier run
      // may have saved another value; put the default back through the real
      // editor, so the capture shows the persisted rule.
      const toggle = page.getByRole('switch', {
        name: t('sandboxes.cleanup.deleteUnused'),
        exact: true,
      });
      const days = page.getByRole('spinbutton', {
        name: t('sandboxes.cleanup.unusedDays'),
        exact: true,
      });
      await expect(days).not.toHaveValue('');
      let changed = false;
      if ((await toggle.getAttribute('aria-checked')) !== 'true') {
        await toggle.click();
        changed = true;
      }
      const unusedDays = String(DEFAULT_SANDBOX_WORKSPACES.unusedDays);
      if ((await days.inputValue()) !== unusedDays) {
        await days.fill(unusedDays);
        changed = true;
      }
      if (changed) {
        const save = page.getByRole('button', {
          name: t('common.actions.save'),
          exact: true,
        });
        await expect(save).toBeEnabled();
        await save.click();
        await expect(
          page.getByRole('button', {
            name: t('common.actions.saved'),
            exact: true,
          }),
        ).toBeVisible();
        await page.reload();
        await expect(
          page.getByRole('spinbutton', {
            name: t('sandboxes.cleanup.unusedDays'),
            exact: true,
          }),
        ).toHaveValue(unusedDays);
      }
    },
    readyWhen: (page) =>
      page.getByRole('spinbutton', {
        name: t('sandboxes.cleanup.unusedDays'),
        exact: true,
      }),
    capture: (page) =>
      page.getByRole('region', {
        name: t('sandboxes.cleanup.title'),
        exact: true,
      }),
  },
  {
    name: 'sandbox-infrastructure-capacity',
    section: 'platform',
    route: '/dashboard/:orgId/settings/sandboxes',
    prepare: async (page) => {
      await expect(
        page.getByRole('button', {
          name: t('sandboxes.capacity.refresh'),
          exact: true,
        }),
      ).toBeEnabled();
      // This shot explains observed capacity. A disconnected spawner must not
      // silently replace the example with four unavailable cards.
      await expect(
        page.getByText(t('sandboxes.capacity.scopes.host'), { exact: true }),
      ).toBeVisible();
    },
    readyWhen: (page) =>
      page.getByRole('region', {
        name: t('sandboxes.capacity.title'),
        exact: true,
      }),
    capture: (page) =>
      page.getByRole('region', {
        name: t('sandboxes.capacity.title'),
        exact: true,
      }),
  },
  {
    // Settings > Sandboxes > Add device — the one-line install-and-connect
    // command and the shorter form for a machine that already has the CLI.
    // Opening the dialog mints a single-use join token; the waiting status
    // renders only once it has arrived.
    name: 'sandbox-add-device',
    section: 'platform',
    route: '/dashboard/:orgId/settings/sandboxes',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('sandboxes.devices.add'), exact: true })
        .click();
    },
    readyWhen: (page) =>
      page
        .getByRole('dialog', { name: t('sandboxes.devices.addDialog.title') })
        .getByText(t('sandboxes.devices.addDialog.waiting')),
    // The commands carry the rig's origin and a live join token; the
    // sanitizer swaps in the production-shaped host and the dialog's own
    // stand-in token.
    sanitize: replaceRigNames,
    capture: (page) =>
      page.getByRole('dialog', {
        name: t('sandboxes.devices.addDialog.title'),
      }),
  },
  {
    // Governance > Guardrails — the three filter-layer status cards, the
    // org's custom instructions, and the content-safety, PII, and moderation
    // editors that filter every message in both directions. The enable
    // labels are switches' aria-labels, never text — gate on the recent-events
    // feed's resolved empty state instead: it is the last query on the page to
    // answer, and there are genuinely no events.
    name: 'governance-guardrails',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/guardrails',
    readyWhen: (page) =>
      page
        .getByText(t('governance.guardrailsOverview.recentEvents.empty.title'))
        .first(),
  },
  {
    // Governance > Security & Monitoring — login-attempt limits, password
    // policy, two-factor policy, and the session idle timeout.
    name: 'governance-security-monitoring',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/security-monitoring',
    // Every enable label here is a switch's aria-label, never text, and the
    // four editors reveal together (the route preloads their policies) — gate
    // on the LAST editor's switch; masked leaves are aria-hidden, so the role
    // query resolves only once it has really rendered.
    readyWhen: (page) =>
      page.getByRole('switch', {
        name: t('governance.sessionIdleTimeout.enabled'),
      }),
    // Land the fold ON a section boundary (measured) — 900 sliced the password
    // policy's Save/Discard row, 1120 sliced the two-factor grace-period input.
    viewport: { width: 1440, height: 1260 },
  },
  {
    // Governance > Logs — the audit trail narrowed to the Member category
    // (the `category` search the Filter writes), so the rows are the seed's
    // member and team changes rather than the capture rig's session sweeps.
    // Gate on the row-count footer, which renders once the listing answered.
    name: 'governance-audit-logs',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/logs?category=member',
    readyWhen: (page) => page.locator('output').first(),
    localizedReadyWhen: (page) =>
      page
        .getByRole('heading', { name: t('settings.logs.heading'), exact: true })
        .first(),
  },
  {
    // Governance > Legal hold — the active-holds table and the Place legal
    // hold action that freezes data against the retention sweep.
    name: 'governance-legal-hold',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/legal-hold',
    // Gate on the LAST thing to resolve, not the first. The Place-hold button
    // paints instantly while the release-request tables are still in flight, so
    // gating on it froze two tables mid-skeleton. Their resolved state (the
    // empty-state title — there are genuinely no release requests) is the honest
    // "page is done" marker.
    readyWhen: (page) =>
      page
        .getByText(
          t('governance.legalHold.sections.releaseRequests.empty.title'),
        )
        .first(),
    // Ends after the release-request tables, before the Matters card — 1080 cut
    // straight through that table's header.
    viewport: { width: 1440, height: 960 },
  },
  {
    // Governance > Data subject requests — the DSAR policy and request list
    // with the File request action.
    name: 'governance-data-subject-requests',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/data-subject-requests',
    readyWhen: (page) =>
      page
        .getByText(t('governance.dataSubjectRequests.actions.fileRequest'))
        .first(),
  },
  {
    // Settings > Enterprise SSO — the single-sign-on connection form (protocol
    // picker, sign-in fields) plus SCIM provisioning. One connection per org.
    name: 'settings-enterprise-sso',
    section: 'platform',
    route: '/dashboard/:orgId/settings/enterprise-sso',
    // Fill the connection's identity fields so the page shows a configured
    // connection instead of three blank inputs. NEVER saved: persisting an SSO
    // connection would put a live identity provider in front of sign-in and
    // lock the capture rig out of its own workspace.
    prepare: async (page) => {
      // Textbox role, not getByLabel: the settings row wrapping each field is
      // itself aria-labelledby the same label, so a bare label query resolves
      // to the row AND the input (a strict-mode violation).
      await page
        .getByRole('textbox', {
          name: labelStart(t('settings.enterpriseSso.issuerLabel')),
        })
        .fill(DEMO_SSO_EXAMPLE.issuerUrl);
      await page
        .getByRole('textbox', {
          name: labelStart(t('settings.enterpriseSso.clientIdLabel')),
        })
        .fill(DEMO_SSO_EXAMPLE.clientId);
    },
    readyWhen: (page) =>
      page.getByText(t('settings.enterpriseSso.protocolLabel')).first(),
    // The redirect-URL field shows the capture rig's localhost origin.
    sanitize: replaceRigNames,
  },
] as const;
