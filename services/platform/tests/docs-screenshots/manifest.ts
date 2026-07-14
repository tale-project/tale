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

import type { Locator, Page } from '@playwright/test';

import { composer, messageLog } from '../e2e/helpers/chat';
import { t } from '../e2e/helpers/i18n';
import {
  DEMO_CHAT_PROMPTS,
  DEMO_DISCUSSIONS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_PROJECT_FILES,
  DEMO_PROJECTS,
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
const PYTHON_PROMPT = 'Write a Python script to deduplicate our CRM export';
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
    },
    readyWhen: (page) =>
      messageLog(page).getByText('Across the three onboarding calls'),
  },
  {
    name: 'chat-composer',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    readyWhen: (page) => composer(page),
    capture: (page) =>
      // The composer strip plus its pickers — the region a new user acts in.
      page
        .getByRole('textbox', { name: t('chat.aria.chatInput') })
        .locator('..'),
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
    readyWhen: (page) => page.getByText(DEMO_PROJECTS[0].tasks[0]),
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
    // The Agents & models tab — the Recommended/Restricted curation modes
    // for agents and models.
    name: 'project-agents-models',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/agents'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByText(t('projects.agents.modeRecommendedDescription')).first(),
  },
  {
    // The Discussions tab with the seeded open discussions.
    name: 'project-discussions-list',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/discussions'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) => page.getByText(DEMO_DISCUSSIONS[0].title).first(),
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
    // The agent picker open over the composer, listing the catalog agents.
    name: 'chat-agent-picker',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('chat.agentSelector.label') })
        .first()
        .click();
    },
    readyWhen: (page) =>
      page.getByPlaceholder(t('chat.agentSelector.searchPlaceholder')).first(),
  },
  {
    // The composer's plus menu — attachments, modes, and sandbox toggles.
    name: 'chat-composer-menu',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('composer.openMenu') })
        .first()
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('menuitem', { name: t('chat.arena.label') }).first(),
  },
  {
    // A code reply that fits inline — the contrast case for the Canvas page.
    name: 'chat-code-reply',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await page.goto(chatThreadRoute(ctx, PYTHON_PROMPT), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) => page.getByText('crm-deduped.csv').first(),
  },
  {
    // The share dialog on a seeded chat — enable toggle + org-scoped copy.
    name: 'chat-share-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page, ctx) => {
      await page.goto(chatThreadRoute(ctx, FEEDBACK_PROMPT), {
        waitUntil: 'domcontentloaded',
      });
      // The thread header carries a direct Share button (no menu hop).
      await page.getByRole('button', { name: /share/i }).first().click();
    },
    readyWhen: (page) => page.getByText(t('chat.share.enableSharing')).first(),
    sanitize: async (page) => {
      // The share-link input shows the capture rig's localhost origin.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('input')) {
          if (el.value.startsWith('http://localhost:3000/')) {
            el.value = el.value.replace(
              'http://localhost:3000/',
              'https://tale.yourcompany.com/',
            );
          }
        }
      });
    },
  },
  {
    // Arena Mode: the same prompt streamed into two model columns.
    name: 'chat-arena-split',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page) => {
      // Arena Mode is an entry in the composer's "+" mode menu.
      await page
        .getByRole('button', { name: t('composer.openMenu') })
        .first()
        .click();
      await page
        .getByRole('menuitem', { name: t('chat.arena.label') })
        .first()
        .click();
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
    readyWhen: (page) =>
      page.getByText('Help me write a clear, professional email').first(),
  },
  {
    // The @-mention picker over the org's indexed knowledge documents.
    name: 'chat-mention-picker',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page) => {
      const input = page.getByRole('textbox', {
        name: t('chat.aria.chatInput'),
      });
      await input.click();
      await input.pressSequentially('@', { delay: 120 });
    },
    readyWhen: (page) => page.getByText('2026-brand-guidelines.txt').first(),
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
    name: 'settings-providers',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/providers',
    readyWhen: (page) => page.getByText('OpenRouter').first(),
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
    name: 'settings-api-keys',
    section: 'get-started',
    route: '/dashboard/:orgId/settings/api/rest',
    readyWhen: (page) =>
      page.getByRole('button', { name: t('settings.apiKeys.createKey') }),
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
    name: 'agent-editor-tools',
    section: 'platform',
    route: '/dashboard/:orgId/agents/assistant/tools',
    readyWhen: (page) =>
      page
        .getByText(t('settings.agents.tools.categories.tasksProjects'))
        .first(),
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
    // The Automations catalog, All tab — builtin automation and bundle cards
    // with their install state.
    name: 'automations-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/automations?tab=all',
    readyWhen: (page) =>
      page.getByText('Resolve GitHub issues', { exact: true }).first(),
  },
  {
    // The automation's workflow editor tab — step graph on the canvas with
    // the AI editor panel toggled open alongside (the hidden autoInstall
    // triage automation renders the same editor every automation gets).
    name: 'automation-editor-canvas',
    section: 'platform',
    route: '/dashboard/:orgId/automations/triage-unassigned-tasks?tab=editor',
    // The AI editor panel opens by default on the editor tab — never click
    // the toolbar toggle here, it would CLOSE it. Wait for the graph, then
    // gate on the open panel's title so both are in frame.
    prepare: async (page, _ctx) => {
      await page
        .getByText('Score candidates against the task')
        .first()
        .waitFor({ timeout: 30_000 });
    },
    readyWhen: (page) =>
      page.getByText(t('workflows.sidePanel.aiAssistant')).first(),
  },
  {
    // The Configuration tab — name, timeout, retries, variables, env.
    name: 'automation-configuration',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/triage-unassigned-tasks?tab=configuration',
    // Wait for the variables editor to render its loaded JSON, not the
    // loading skeleton.
    readyWhen: (page) => page.getByText('workflowId').first(),
  },
  {
    // The Triggers tab with the Events section expanded to show the builtin
    // event subscription row.
    name: 'automation-triggers',
    section: 'platform',
    route: '/dashboard/:orgId/automations/triage-unassigned-tasks?tab=triggers',
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
    name: 'automation-executions',
    section: 'platform',
    route:
      '/dashboard/:orgId/automations/triage-unassigned-tasks?tab=executions',
    readyWhen: (page) =>
      page.getByText(t('workflows.steps.execution.status.failed')).first(),
  },
  {
    // Settings > Integrations, All integrations tab — the builtin catalog.
    name: 'integrations-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/settings/integrations?tab=all',
    readyWhen: (page) => page.getByText('Tavily', { exact: true }).first(),
  },
  {
    // Settings > API > MCP with the Add MCP server dialog open — transport
    // and authentication are the whole form.
    name: 'settings-mcp-add-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/mcp',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('mcpServers.addServer') })
        .first()
        .click();
    },
    readyWhen: (page) =>
      page.getByText(t('mcpServers.form.transportType')).first(),
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
    // The voice-output row renders after the TTS-availability check — once it
    // is there, the whole page is.
    readyWhen: (page) =>
      page.getByText(t('personalization.page.voiceOutput.label')).first(),
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
    // The Prompt library dialog over the chat composer, with the provisioned
    // starter prompts, scope tabs, and filters.
    name: 'prompt-library-dialog',
    section: 'platform',
    route: '/dashboard/:orgId/chat',
    prepare: async (page) => {
      await page
        .getByRole('button', { name: t('chat.promptLibrary') })
        .first()
        .click();
    },
    // One of the provisioned default prompts every fresh org carries.
    readyWhen: (page) => page.getByText('Weigh Pros and Cons').first(),
  },
  {
    // Settings > AI providers with the provider drawer open on the models
    // region — the per-model capability tags are the point.
    name: 'settings-provider-models',
    section: 'platform',
    route: '/dashboard/:orgId/settings/providers',
    prepare: async (page) => {
      // A click that lands before hydration is swallowed — retry until the
      // drawer actually opens.
      const detail = page.getByText(t('settings.providers.details')).first();
      for (let i = 0; i < 5 && !(await detail.isVisible()); i++) {
        await page.getByText('OpenRouter').first().click();
        await detail.waitFor({ timeout: 3000 }).catch(() => {
          console.warn('provider drawer not open yet — retrying the click');
        });
      }
      // A model row that only exists in the drawer's model list (the Default
      // Models card above it repeats the default models' names). Scroll it
      // into view so the crop shows the list, not the drawer header.
      await page.getByText('Gemma 4 31B IT').first().scrollIntoViewIfNeeded();
    },
    readyWhen: (page) => page.getByText('Gemma 4 31B IT').first(),
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
  },
  {
    // Governance > Legal hold — the active-holds table and the Place legal
    // hold action that freezes data against the retention sweep.
    name: 'governance-legal-hold',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/legal-hold',
    readyWhen: (page) =>
      page.getByText(t('governance.legalHold.actions.placeHold')).first(),
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
    readyWhen: (page) =>
      page
        .getByText(t('settings.integrations.enterpriseSso.protocolLabel'))
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
