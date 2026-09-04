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
import { TIMEOUT } from '../e2e/helpers/env';
import { labelStart } from '../e2e/helpers/forms';
import { t } from '../e2e/helpers/i18n';
import {
  DEMO_API_KEYS,
  DEMO_CHAT_PROMPTS,
  DEMO_DOCUMENTS,
  DEMO_KNOWLEDGE_ENTRIES,
  DEMO_ORG_NAME,
  DEMO_OWNER,
  DEMO_PROJECT_FILES,
  DEMO_PROJECTS,
  DEMO_PROVIDER_CREDENTIAL,
  DEMO_SSO_EXAMPLE,
  MOCK_PROVIDER_DISPLAY_NAME,
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

/**
 * The explicit fresh composer. A bare `/chat` RESUMES the caller's most
 * recent thread, so a shot that wants the empty new-chat screen — or that
 * sends a message meant to start its own thread — must ask for a fresh one,
 * or it lands (and types) inside whatever thread was open last. `new=true`
 * is the form the in-app links send: the router parses search params as
 * JSON, so `?new=1` would arrive as a number.
 */
const FRESH_CHAT_ROUTE = '/dashboard/:orgId/chat?new=true';

const projectRoute = (ctx: ShotContext, sub = ''): string => {
  const projectId = ctx.projects.get(RELAUNCH_PROJECT);
  if (!projectId) {
    throw new Error(
      `No seeded project "${RELAUNCH_PROJECT}" — run without --skip-seed.`,
    );
  }
  return `/dashboard/${ctx.orgId}/projects/${projectId}${sub}`;
};

/**
 * Sanitizer for pages that print the deployment's own origin (a redirect
 * URL, a connection URL, an API endpoint): swap the capture rig's localhost
 * for a production-shaped host so no published image shows the rig.
 */
const replaceRigOrigin = async (page: Page): Promise<void> => {
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
    // The project's General tab — identity form, standing instructions, and
    // sharing. The whole page waits for the project record, and the sharing
    // section then waits for the teams query (until it answers it shows a
    // "no teams yet" hint) — so the owning-team picker is the last thing to
    // settle and the honest "loaded" marker.
    name: 'project-general-tab',
    section: 'platform',
    route: '/dashboard/:orgId/projects',
    prepare: async (page, ctx) => {
      await page.goto(projectRoute(ctx, '/overview'), {
        waitUntil: 'domcontentloaded',
      });
    },
    readyWhen: (page) =>
      page.getByText(t('projects.settings.owningTeam')).first(),
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
    // Each row names the provider serving its model — the mock gateway here;
    // a customer's row names a real vendor.
    sanitize: async (page) => {
      await page.evaluate(
        ({ rig, real }) => {
          for (const el of document.querySelectorAll('span, div, p')) {
            if (el.children.length === 0 && el.textContent?.includes(rig)) {
              el.textContent = el.textContent.replace(rig, real);
            }
          }
        },
        { rig: MOCK_PROVIDER_DISPLAY_NAME, real: 'OpenRouter' },
      );
    },
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
    // on …") is the stable marker of the shared view. English is fine — the
    // capture context pins the en locale like the other literal waits here.
    readyWhen: (page) => page.getByText('Shared by', { exact: false }).first(),
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
    // The knowledge documents table with the seeded believable files.
    name: 'documents-list',
    section: 'get-started',
    route: '/dashboard/:orgId/documents',
    readyWhen: (page) => page.getByText('2026-brand-guidelines.txt'),
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
    readyWhen: (page) =>
      page
        .getByRole('row')
        .filter({ hasText: DEMO_PROVIDER_CREDENTIAL })
        .first(),
    sanitize: async (page) => {
      // The seeded credential sits on the offline mock gateway; a customer's
      // row names a real vendor — the production-shaped equivalent, never an
      // invented row.
      await page.evaluate(
        ({ rig, real }) => {
          for (const el of document.querySelectorAll('td, span, div')) {
            if (el.children.length === 0 && el.textContent?.includes(rig)) {
              el.textContent = el.textContent.replace(rig, real);
            }
          }
        },
        { rig: MOCK_PROVIDER_DISPLAY_NAME, real: 'OpenRouter' },
      );
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
    // The Automations page — the seeded pack rows with their version count
    // and deployment state, plus the Create automation menu.
    name: 'automations-catalog',
    section: 'platform',
    route: '/dashboard/:orgId/automations',
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
      await page
        .getByRole('button', { name: t('automations.builder.new') })
        .click();
      await page
        .getByRole('menuitem', { name: t('automations.upload.trigger') })
        .click();
    },
    readyWhen: (page) =>
      page.getByRole('heading', { name: t('automations.upload.title') }),
  },
  {
    // The automation workbench — the saved version's step graph on the canvas
    // with the node inspector beside it. The seeded Gmail triage pack stands
    // in for every automation: they all render this same workbench.
    name: 'automation-editor-canvas',
    section: 'platform',
    // A pack's automation is NAMED after its path with the separator
    // flattened (`gmail/triage-inbox` → `gmail-triage-inbox`, see
    // lib/automations/packs), so the route param is that name — the `__`
    // codec is only for names that carry a real `/`.
    route: '/dashboard/:orgId/automations/gmail-triage-inbox',
    // Select the LLM step so the inspector shows a node's fields instead of
    // its "select a node" hint — the frame then teaches both halves at once.
    // A node box is a button carrying `data-automation-node=<id>` (the same
    // attribute the inspector's Close restores focus to).
    prepare: async (page) => {
      const triageStep = page.locator('[data-automation-node="triage"]');
      await triageStep.waitFor({ timeout: 30_000 });
      await triageStep.click();
    },
    // The inspector renders the selected node's Input field only once the
    // node-type catalog has answered — gate on it so the panel is never
    // captured mid-load.
    readyWhen: (page) =>
      page
        .getByText(t('automations.editor.fields.input'), { exact: true })
        .first(),
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
    readyWhen: (page) => page.getByText('/api/v1/mcp').first(),
    // The endpoint URL and the example request print the rig's origin.
    sanitize: replaceRigOrigin,
  },
  {
    // Settings > API > WebDAV — connection details and the app-password
    // generator.
    name: 'settings-webdav',
    section: 'platform',
    route: '/dashboard/:orgId/settings/api/webdav',
    readyWhen: (page) =>
      page.getByText(t('webdav.connectionDetails.title')).first(),
    // The connection URL shows the capture rig's localhost origin.
    sanitize: replaceRigOrigin,
  },
  {
    // Settings > Preferences — the custom-instructions and memories sections,
    // each with its own toggle over the org default: the per-user layer.
    name: 'settings-preferences',
    section: 'platform',
    route: '/dashboard/:orgId/settings/personalization',
    // Gate on the Memories list's resolved empty state — the LAST thing on
    // this page to settle: the memories query answers after the preferences
    // do, and until it does the list reads "backend unavailable", not empty.
    readyWhen: (page) =>
      page.getByText(t('personalization.page.memories.empty')).first(),
  },
  {
    // Settings > Governance > Content & Models — the default-model rules,
    // model access, and the vision model every chat and agent passes through
    // at request time. (The org's custom instructions live on Guardrails.)
    // Section titles paint before their data, so gate on the LAST thing to
    // resolve: the vision-model editor's "currently reading images with …"
    // line, which waits on the provider catalog. The message carries a
    // placeholder, so match the text ahead of it — or the no-model variant,
    // which has none.
    name: 'governance-content-models',
    section: 'platform',
    route: '/dashboard/:orgId/settings/governance/content-models',
    readyWhen: (page) => {
      const resolved = t('governance.visionModel.resolved.pinned');
      const prefix = resolved.slice(0, resolved.indexOf('{')).trim();
      return page
        .getByText(prefix)
        .or(page.getByText(t('governance.visionModel.resolvedNone')))
        .first();
    },
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
    sanitize: replaceRigOrigin,
  },
] as const;
