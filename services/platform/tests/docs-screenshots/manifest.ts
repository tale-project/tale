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
 *   - Locators resolve labels through `t()` (tests/e2e/helpers/i18n) — never a
 *     hardcoded English literal.
 *   - `readyWhen` waits on authoritative state (a locator), never on time.
 *   - `capture.element` crops to a region; omit for the full viewport.
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { composer, messageLog, sendButton } from '../e2e/helpers/chat';
import { labelStart } from '../e2e/helpers/forms';
import { t } from '../e2e/helpers/i18n';
import {
  DEMO_API_KEYS,
  DEMO_CHAT_PROMPTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_ORG_NAME,
  DEMO_PROJECT_FILES,
  DEMO_PROJECTS,
  DEMO_SSO_EXAMPLE,
} from './demo-content';

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
  /**
   * Sanitization ONLY — run after `readyWhen`, before the screenshot.
   * Replace instance-local values (loopback URLs, machine hostnames) with
   * their production-shaped equivalents so a published image never shows
   * the capture rig. Never fabricate content that would not exist.
   */
  readonly sanitize?: (page: Page, ctx: ShotContext) => Promise<void>;
  /** Element crop; omit for the full viewport. */
  readonly capture?: (page: Page, ctx: ShotContext) => Locator;
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

const FEEDBACK_PROMPT = DEMO_CHAT_PROMPTS[0];
const RELAUNCH_PROJECT = DEMO_PROJECTS[0].name;

const projectRoute = (ctx: ShotContext, sub = ''): string => {
  const projectId = ctx.projects.get(RELAUNCH_PROJECT);
  if (!projectId) {
    throw new Error(
      `No seeded project "${RELAUNCH_PROJECT}" — run without --skip-seed.`,
    );
  }
  return `/dashboard/${ctx.orgId}/projects/${projectId}${sub}`;
};

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
  },
  {
    name: 'chat-composer',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
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
    // The board renders SIX columns (Backlog … Cancelled) and they do not fit
    // the standard 1440 frame — the last one gets sliced. Widen just this shot.
    // Keep 1.6:1 (1920×1200): the README gallery tiles are straight downscales
    // of these frames, and an off-ratio source would letterbox its tile.
    viewport: { width: 1920, height: 1200 },
  },
  {
    // The project's General tab — identity form, sharing, and the stats
    // strip; the file count only renders once the project data has loaded.
    name: 'project-general-tab',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx), { waitUntil: 'domcontentloaded' });
    },
    readyWhen: (page) =>
      page.getByText(`${DEMO_PROJECT_FILES.length} files`).first(),
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
    // The Agents tab — the project's agent instances.
    name: 'project-agents-models',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/agents'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByText(t('projects.agents.agentsHeading')).first(),
  },
  {
    // Knowledge > Knowledge entries with the seeded manual facts.
    name: 'knowledge-entries-list',
    section: 'platform',
    route: '/dashboard/:orgId/knowledge-entries',
    readyWhen: (page) =>
      page.getByText(DEMO_KNOWLEDGE_ENTRIES[0].topic).first(),
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
      // Share puts the snapshot URL on the clipboard (idempotent: sharing
      // again refreshes the snapshot, same link). The capture context has
      // clipboard-read granted for exactly this hop.
      await page
        .getByRole('button', { name: t('chat.aria.threadActions') })
        .click();
      await page
        .getByRole('menuitem', { name: t('chat.share.button') })
        .first()
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()), {
          timeout: 15_000,
        })
        .toMatch(/\/chat\/shared\//);
      const sharedUrl = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      await page.goto(sharedUrl, { waitUntil: 'domcontentloaded' });
    },
    // The heading prefers the thread's own title; the byline ("Shared by …
    // on …") is the stable marker of the shared view. English is fine — the
    // capture context pins the en locale like the other literal waits here.
    readyWhen: (page) => page.getByText('Shared by', { exact: false }).first(),
  },
  {
    // Arena Mode: the same prompt streamed into two model columns.
    name: 'chat-arena-split',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
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
    route: '/dashboard/:orgId/chat',
    // The starters render immediately; the picker's model label does not
    // (same composer-options race as chat-composer) — gate on the label.
    readyWhen: (page) =>
      page
        .getByRole('button', { name: t('chat.picker.ariaLabel') })
        .filter({ hasNotText: t('chat.modelSelector.noModelsAvailable') }),
  },
  {
    // The knowledge documents table with the seeded believable files.
    name: 'documents-list',
    section: 'get-started',
    route: '/dashboard/:orgId/documents',
    readyWhen: (page) => page.getByText('2026-brand-guidelines.txt'),
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
    // Members live inside Settings > Organization (there is no separate
    // People page); the members table is the region worth showing.
    name: 'settings-organization-members',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/organization',
    readyWhen: (page) => page.getByText('Alex Rivera').first(),
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
    // The AI providers catalog. `getByText('OpenRouter')` also matches the
    // Default Models card above the grid and would fire while the grid is still
    // skeletons — gate on the provider's own CARD, whose accessible name only
    // exists once the card has rendered.
    name: 'settings-providers',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/providers',
    readyWhen: (page) =>
      page.getByRole('heading', { name: 'OpenRouter', level: 3 }),
    sanitize: async (page) => {
      // The demo provider points at the offline mock gateway; a customer's
      // row shows the real endpoint.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('td, span, div')) {
          if (
            el.children.length === 0 &&
            el.textContent?.includes('127.0.0.1:4141')
          ) {
            el.textContent = 'https://openrouter.ai/api/v1';
          }
        }
      });
    },
  },
  {
    // The API keys table with the seeded keys. Gating on the Create button
    // captured the loading skeleton — the button renders long before the rows
    // do. Gate on a seeded ROW instead.
    name: 'settings-api-keys',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/api/rest',
    readyWhen: (page) =>
      page.getByRole('row').filter({ hasText: DEMO_API_KEYS[0] }).first(),
  },
  {
    // The agent editor's General tab (agent type, Visible in chat, name),
    // reached the way a reader would: expand the chat folder, open Assistant.
    name: 'agent-editor-general',
    section: 'get-started',
    route: '/dashboard/:orgId/agents',
    prepare: async (page) => {
      await page.getByText('chat', { exact: true }).first().click();
      await page.getByText('Assistant', { exact: true }).first().click();
      await page.waitForURL(/\/agents\/[A-Za-z0-9]+/, { timeout: 30_000 });
    },
    readyWhen: (page) => page.getByText('General-purpose AI assistant').first(),
  },
  {
    // The agents list with the chat folder expanded — folders come from the
    // slug's `/` prefix, so the two builtin chat agents show as rows.
    name: 'agents-list-expanded',
    section: 'platform',
    route: '/dashboard/:orgId/agents',
    prepare: async (page) => {
      await page.getByText('chat', { exact: true }).first().click();
    },
    readyWhen: (page) =>
      page.getByText('Automation Assistant', { exact: true }).first(),
  },
  {
    // The Instructions & models tab — system prompt plus the ordered model
    // list (first = primary, rest = fallbacks) on the builtin Assistant.
    name: 'agent-editor-instructions',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/instructions',
    readyWhen: (page) => page.getByText('Claude Haiku 4.5').first(),
  },
  {
    // The Tools tab — per-tool toggles grouped by category, plus the
    // web-search mode selector at the top.
    //
    // While `getAvailableTools` is unresolved the selector renders a PLACEHOLDER
    // of three fake categories with two masked rows each — every card reads
    // "0/2" and nothing is checked. The old gate (a category heading) matched
    // that placeholder, so the shot captured an agent that looked to grant no
    // tools at all. Gate on a real granted count instead: the Assistant holds
    // all seven file tools.
    name: 'agent-editor-tools',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/tools',
    prepare: async (page) => {
      // The granted categories sit below the fold of the masonry; bring them
      // into frame so the shot shows checked boxes, not just empty ones.
      await page.getByText('7/7').first().waitFor({ timeout: 30_000 });
      await page.getByText('7/7').first().scrollIntoViewIfNeeded();
    },
    readyWhen: (page) => page.getByText('7/7').first(),
  },
  {
    // The Knowledge tab — retrieval mode, team/org document scopes, and the
    // seeded organization documents with their index state.
    name: 'agent-editor-knowledge',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/knowledge',
    readyWhen: (page) => page.getByText('2026-brand-guidelines.txt').first(),
  },
  {
    // The Starters tab with the Assistant's four seeded conversation
    // starters — the fourth row number only renders once the values load.
    name: 'agent-editor-starters',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/conversation-starters',
    readyWhen: (page) => page.getByText('4.', { exact: true }).first(),
  },
  {
    // The Webhooks tab with one live webhook row. Creating the webhook is
    // idempotent-by-guard: only when the tab is still in its empty state.
    name: 'agent-editor-webhooks',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/webhook',
    prepare: async (page) => {
      const createButton = page.getByRole('button', {
        name: t('settings.agents.webhook.createButton'),
      });
      await createButton.waitFor({ timeout: 30_000 });
      const emptyState = page.getByText(
        t('settings.agents.webhook.emptyTitle'),
      );
      if (await emptyState.isVisible().catch(() => false)) {
        await createButton.click();
        await page
          .getByText(t('settings.agents.webhook.urlWarning'))
          .first()
          .waitFor({ timeout: 30_000 });
        await page.keyboard.press('Escape');
      }
    },
    readyWhen: (page) => page.getByText('/api/agents/wh/').first(),
    sanitize: async (page) => {
      // The webhook URL cell shows the capture rig's localhost origin.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('td, span, div, code')) {
          if (
            el.children.length === 0 &&
            el.textContent?.includes('http://localhost:3000/')
          ) {
            el.textContent = el.textContent.replace(
              'http://localhost:3000/',
              'https://tale.yourcompany.com/',
            );
          }
        }
      });
    },
  },
  {
    // The Automations page — the seeded pack rows with their version count
    // and deployment state, plus the New automation create menu.
    name: 'automations-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/automations',
    readyWhen: (page) =>
      page.getByText('gmail-triage-inbox', { exact: true }).first(),
  },
  {
    // The Upload package dialog — file drop zone and the Install into picker.
    // Its trigger is an item of the New automation create menu.
    name: 'automations-upload-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/automations',
    prepare: async (page) => {
      await page.getByTestId('new-automation').click();
      await page
        .getByRole('menuitem', { name: t('automations.upload.trigger') })
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('heading', { name: t('automations.upload.title') }),
  },
  {
    // The automation's workflow editor tab — step graph on the canvas with
    // the AI editor panel toggled open alongside (the hidden autoInstall
    // triage automation renders the same editor every automation gets).
    name: 'automation-editor-canvas',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/projects__tasks__triage-unassigned?tab=editor',
    // The AI editor panel opens by default on the editor tab — never click
    // the toolbar toggle here, it would CLOSE it. Wait for the graph, then
    // gate on the open panel's title so both are in frame.
    prepare: async (page, _ctx) => {
      await page
        .getByText('Score candidates against the task')
        .first()
        .waitFor({ timeout: 30_000 });
      // The "this workflow is active" banner overlays the top of the canvas and
      // buries the Start node. It is dismissible — close it so the graph reads
      // from its first step.
      const dismiss = page
        .getByRole('button', { name: t('common.aria.dismiss') })
        .first();
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
    },
    readyWhen: (page) =>
      page.getByText(t('workflows.sidePanel.aiAssistant')).first(),
  },
  {
    // The Configuration tab — name, timeout, retries, variables, env.
    name: 'automation-configuration',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/projects__tasks__triage-unassigned?tab=configuration',
    // Wait for the variables editor to render its loaded JSON, not the
    // loading skeleton.
    readyWhen: (page) => page.getByText('workflowId').first(),
  },
  {
    // The Triggers tab with the Events section expanded to show the builtin
    // event subscription row.
    name: 'automation-triggers',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/projects__tasks__triage-unassigned?tab=triggers',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('workflows.triggers.events.title') })
        .first()
        .click();
    },
    readyWhen: (page) =>
      page.getByText(t('workflows.triggers.events.columns.eventType')).first(),
  },
  {
    // The Executions tab — one row per run with status, timing, and source.
    // Gate on a COMPLETED run: the seeded tasks each fire the triage automation,
    // and all but one complete (the mock answers one task's scoring step with a
    // payload that violates the step's schema — that single red badge is what
    // the execution-logs page teaches debugging from).
    //
    // The executions table renders its badge from `common.status.*` — NOT the
    // `workflows.steps.execution.status.*` namespace that this gate used to
    // read. Both resolve to "Failed" in English, so the old gate passed by
    // coincidence; `common.status.completed` is the real key.
    name: 'automation-executions',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/projects__tasks__triage-unassigned?tab=executions',
    readyWhen: (page) => page.getByText(t('common.status.completed')).first(),
  },
  {
    // Settings > Connectors — the shipped catalog as cards. The tab strip
    // opens on All, so the route carries no tab param.
    name: 'connectors-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/settings/connectors',
    readyWhen: (page) => page.getByText('Tavily', { exact: true }).first(),
  },
  {
    // Settings > API > MCP — outbound MCP-server management is retired, so the
    // endpoint (plus the engine method list) is the whole MCP surface. It is an
    // API surface, not one of the per-vendor connectors, and has its own page.
    name: 'settings-mcp-endpoint',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/mcp',
    readyWhen: (page) => page.getByText('/api/v1/mcp').first(),
  },
  {
    // Settings > API > WebDAV — connection details and the app-password
    // generator.
    name: 'settings-webdav',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/webdav',
    readyWhen: (page) =>
      page.getByText(t('webdav.connectionDetails.title')).first(),
    sanitize: async (page) => {
      // The connection URL shows the capture rig's localhost origin.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('td, span, div, code, p')) {
          if (
            el.children.length === 0 &&
            el.textContent?.includes('http://localhost:3000/')
          ) {
            el.textContent = el.textContent.replace(
              'http://localhost:3000/',
              'https://tale.yourcompany.com/',
            );
          }
        }
      });
    },
  },
  {
    // Settings > Preferences — the personalization toggles plus the custom
    // instructions and memories sections, the per-user layer over the org
    // defaults.
    name: 'settings-preferences',
    section: 'platform',
    route: '/dashboard/:orgId/settings/personalization',
    // Gate on the voice-output row's DESCRIPTION, not its label: the label is
    // painted immediately while the row itself is still a placeholder bar
    // (it waits on the TTS-availability check). The description only lands once
    // the row has really resolved — which is also the last thing on this page
    // to do so.
    readyWhen: (page) =>
      page.getByText(t('personalization.page.voiceOutput.description')).first(),
  },
  {
    // Settings > Environment — the personal env/secret store with its inline
    // add form. Every account starts empty; the empty state is the honest
    // first-visit view.
    name: 'settings-environment',
    section: 'platform',
    route: '/dashboard/:orgId/settings/environment',
    readyWhen: (page) => page.getByText(t('userEnv.page.title')).first(),
  },
  {
    // Settings > AI providers with a provider's card open — its credentials and
    // the model allowlist are the point. Deep-linked through the same search
    // param the card writes, so no click has to land before hydration.
    name: 'settings-provider-models',
    section: 'platform',
    route: '/dashboard/:orgId/settings/providers?provider=openrouter',
    prepare: async (page) => {
      await page
        .getByRole('dialog', { name: 'OpenRouter' })
        .waitFor({ timeout: 10_000 });
    },
    readyWhen: (page) => page.getByRole('dialog', { name: 'OpenRouter' }),
    sanitize: async (page) => {
      // The demo provider points at the offline mock gateway; a customer's
      // drawer shows the real endpoint.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('td, span, div')) {
          if (
            el.children.length === 0 &&
            el.textContent?.includes('127.0.0.1:4141')
          ) {
            el.textContent = 'https://openrouter.ai/api/v1';
          }
        }
      });
    },
    capture: (page) => page.getByRole('dialog').last(),
  },
  {
    // Settings > Governance > Content & Models — the org-wide system-prompt
    // prefix/suffix, default models, and model-access controls every chat and
    // agent passes through at request time.
    name: 'governance-content-models',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    readyWhen: (page) =>
      page.getByText(t('governance.systemPrompt.prefixLabel')).first(),
  },
  {
    // Governance > Policies & Limits — budget rules, upload/retention policy,
    // and the sandbox-quota and feature caps that protect the org.
    name: 'governance-policies-limits',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/policies-limits',
    readyWhen: (page) => page.getByText(t('governance.budgets.title')).first(),
    // Land the fold ON a section boundary (measured), not mid-row: any height is
    // a cut somewhere, so cut where the page already has a seam.
    viewport: { width: 1440, height: 1530 },
  },
  {
    // Governance > Run-code packages — the default-mode radiogroup plus the
    // Python/Node allow/deny lists that gate sandbox package installs.
    name: 'governance-run-code-policy',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/run-code-policy',
    readyWhen: (page) =>
      page.getByText(t('governance.runCodePolicy.modeAllowlistLabel')).first(),
  },
  {
    // Governance > Guardrails — content safety, PII protection, and the
    // moderation provider that filter every message in both directions.
    name: 'governance-guardrails',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/guardrails',
    readyWhen: (page) =>
      page.getByText(t('governance.contentSafety.enableLabel')).first(),
  },
  {
    // Governance > Security & Monitoring — login-attempt limits, password
    // policy, two-factor policy, and the session idle timeout.
    name: 'governance-security-monitoring',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/security-monitoring',
    readyWhen: (page) =>
      page.getByText(t('governance.loginPolicy.enabled')).first(),
    // Land the fold ON a section boundary (measured) — 900 sliced the password
    // policy's Save/Discard row, 1120 sliced the two-factor grace-period input.
    viewport: { width: 1440, height: 1260 },
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
      await page
        .getByLabel(
          labelStart(t('settings.connectors.enterpriseSso.issuerLabel')),
        )
        .fill(DEMO_SSO_EXAMPLE.issuerUrl);
      await page
        .getByLabel(
          labelStart(t('settings.connectors.enterpriseSso.clientIdLabel')),
        )
        .fill(DEMO_SSO_EXAMPLE.clientId);
    },
    readyWhen: (page) =>
      page
        .getByText(t('settings.connectors.enterpriseSso.protocolLabel'))
        .first(),
    sanitize: async (page) => {
      // The redirect-URL field shows the capture rig's localhost origin.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('td, span, div, code, p')) {
          if (
            el.children.length === 0 &&
            el.textContent?.includes('http://localhost:3000/')
          ) {
            el.textContent = el.textContent.replace(
              'http://localhost:3000/',
              'https://tale.yourcompany.com/',
            );
          }
        }
      });
    },
  },
] as const;
