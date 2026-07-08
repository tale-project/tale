/**
 * Gates EVERY builtin app bundle (`builtin-configs/automations/<slug>/`) against the
 * platform skeleton — the "new app = data" litmus, generalized from the
 * issue-desk-only test so a new bundle is gated the day its directory appears:
 * the manifest parses, every view is a valid automation-view document whose bound
 * functions are all declared in the app's `capabilities.functions` allowlist,
 * every referenced label resolves in every base locale, every bundled workflow
 * parses and validates, and every bundled agent config parses — with zero
 * per-vertical system code. App-specific behavioral pins live in per-app
 * describe blocks below the generic gate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateBundleShape } from '../../../../lib/shared/platform/bundle_validation';
import { validateViewBindings } from '../../../../lib/shared/platform/function_bindings';
import {
  collectWorkflowLabelKeys,
  findMissingLabelKeys,
} from '../../../../lib/shared/platform/label_completeness';
import { agentJsonSchema } from '../../../../lib/shared/schemas/agents';
import { automationViewSchema } from '../../../../lib/shared/schemas/automation_views';
import {
  type AutomationManifest,
  automationManifestSchema,
  type BundleManifest,
  bundleManifestSchema,
  manifestDeclaresBundle,
} from '../../../../lib/shared/schemas/automations';
import { validateWorkflowDefinition } from './validate_workflow_definition';

const AUTOMATIONS_DIR = fileURLToPath(
  new URL('../../../../../../builtin-configs/automations/', import.meta.url),
);

const BASE_LOCALES = ['en', 'de', 'fr'] as const;

const readJson = (abs: string): unknown =>
  JSON.parse(readFileSync(abs, 'utf8'));

/** Whether an app dir is a BUNDLE (ships `bundle.json`). */
const isBundleAppDir = (appDir: string): boolean =>
  existsSync(join(appDir, 'bundle.json'));

/**
 * Parse a builtin app dir's manifest with the schema its filename implies: a
 * BUNDLE's `bundle.json` via the strict `bundleManifestSchema`, an ordinary
 * automation's `automation.json` via `automationManifestSchema`.
 */
const readManifest = (appDir: string): AutomationManifest | BundleManifest =>
  isBundleAppDir(appDir)
    ? bundleManifestSchema.parse(readJson(join(appDir, 'bundle.json')))
    : automationManifestSchema.parse(readJson(join(appDir, 'automation.json')));

/** Flatten a nested string tree into dot-joined leaf keys, e.g.
 *  `{ a: { b: { c: 'X' } } }` → `{ 'a.b.c': 'X' }`. A builtin workflow step's
 *  `ui.labelKey`/`verdictLabels` value is a PLATFORM `automations` catalog key
 *  (see `label_completeness.ts`'s header), so the gate resolves referenced
 *  keys against the flattened platform namespace, not a per-bundle catalog. */
function flattenMessages(tree: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof tree === 'string') {
    if (prefix) out[prefix] = tree;
    return out;
  }
  if (tree !== null && typeof tree === 'object' && !Array.isArray(tree)) {
    for (const [key, value] of Object.entries(
      tree as Record<string, unknown>,
    )) {
      Object.assign(
        out,
        flattenMessages(value, prefix ? `${prefix}.${key}` : key),
      );
    }
  }
  return out;
}

const PLATFORM_MESSAGES_DIR = fileURLToPath(
  new URL('../../../../messages/', import.meta.url),
);

/** The platform's own `automations` namespace, flattened per base locale —
 *  every builtin workflow step label key must resolve here. */
const platformAutomationsCatalogs = Object.fromEntries(
  BASE_LOCALES.map((locale) => {
    const messages = readJson(
      join(PLATFORM_MESSAGES_DIR, `${locale}.json`),
    ) as Record<string, unknown>;
    return [locale, flattenMessages(messages.automations)];
  }),
);

/** Top-level `*.json` files of a bundle dir (absent dir = empty bundle part). */
const listJsonFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
    : [];

const automationSlugs = readdirSync(AUTOMATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// The suite must never silently pass because the fixture dir moved.
it('discovers at least one builtin app bundle', () => {
  expect(automationSlugs.length).toBeGreaterThan(0);
});

describe.each(automationSlugs)(
  'builtin app "%s" validates against the skeleton',
  (slug) => {
    const appDir = join(AUTOMATIONS_DIR, slug);
    const manifest = readManifest(appDir);
    // A BUNDLE (`bundle.json`) does nothing itself — it ships no views, no
    // inline workflow, no agents, no capability allowlist (its strict schema
    // forbids them), so every automation-specific check below is empty for it.
    const isBundle = manifestDeclaresBundle(manifest);

    const views = listJsonFiles(join(appDir, 'views')).map((file) => ({
      file,
      doc: readJson(join(appDir, 'views', file)),
    }));
    // A non-bundle automation owns AT MOST ONE workflow, authored INLINE under
    // the manifest's `workflow` key (its slug IS the automation slug) — never a
    // standalone `workflows/<slug>/<name>.json` file. Already parsed by
    // `readManifest` above, so a malformed inline workflow fails collection;
    // the pins below assert its shape + graph validity.
    const workflow = isBundle ? undefined : manifest.workflow;
    const allowlistFunctions = isBundle
      ? undefined
      : manifest.capabilities?.functions;
    // Agent references the bundle must be able to resolve: `roles` targets and
    // the declared `agents` list (workflow action steps are collected in the
    // resolution pin below).
    const roles = isBundle ? undefined : manifest.roles;
    const declaredAgentSlugs = isBundle ? undefined : manifest.agents;
    const agents = listJsonFiles(join(appDir, 'agents')).map((file) => ({
      file,
      doc: readJson(join(appDir, 'agents', file)),
    }));

    it('the manifest parses via automationManifestSchema', () => {
      // Parsed at collection above; pin the invariants every bundle must carry.
      expect(manifest.name).toBeTruthy();
    });

    it('ships a non-empty icon.svg (the hub card brand icon)', () => {
      // `listAutomations` serves this file as the card's data-URI icon; the manifest's
      // lucide `icon` name is only the text fallback. Every builtin must carry
      // the real brand glyph.
      const iconPath = join(appDir, 'icon.svg');
      expect(existsSync(iconPath), 'icon.svg missing').toBe(true);
      expect(statSync(iconPath).size, 'icon.svg empty').toBeGreaterThan(0);
    });

    it('every view parses via automationViewSchema', () => {
      for (const { file, doc } of views) {
        const res = automationViewSchema.safeParse(doc);
        expect(res.success, `views/${file}: ${res.error?.message ?? ''}`).toBe(
          true,
        );
      }
    });

    it('every function a view binds is allowlisted in capabilities.functions', () => {
      for (const { file, doc } of views) {
        const errors = validateViewBindings(doc, allowlistFunctions);
        expect(errors, `views/${file}`).toEqual([]);
      }
    });

    it('every referenced workflow step label key resolves in en/de/fr', () => {
      // Views hold no label keys any more (their strings are literals); a
      // step's `ui.labelKey`/`verdictLabels` resolves against the platform's
      // own `automations` catalog, never a per-bundle one.
      const referenced = workflow
        ? collectWorkflowLabelKeys(workflow as { steps?: unknown })
        : [];
      expect(
        findMissingLabelKeys(
          referenced,
          platformAutomationsCatalogs,
          BASE_LOCALES,
        ),
      ).toEqual([]);
    });

    it('ships no standalone workflows/ dir — the single workflow is inline', () => {
      expect(existsSync(join(appDir, 'workflows'))).toBe(false);
    });

    it('the inline workflow (when present) passes validateWorkflowDefinition', () => {
      if (!workflow) return;
      const result = validateWorkflowDefinition(
        workflow.steps as Array<Record<string, unknown>>,
      );
      expect(result.errors).toEqual([]);
    });

    it('every bundled agent parses via agentJsonSchema', () => {
      for (const { file, doc } of agents) {
        const res = agentJsonSchema.safeParse(doc);
        expect(res.success, `agents/${file}: ${res.error?.message ?? ''}`).toBe(
          true,
        );
      }
    });

    it('every referenced agent resolves to a bundled agent file', () => {
      // Agent slugs are addressed `<pack>/<name>` (or bare `<name>`); the file
      // is always `agents/<name>.json`. Collect every reference the manifest and
      // its inline workflow make — `roles` targets, the declared `agents` list,
      // and each workflow action step that runs an agent — and assert each
      // resolves. This is the agent analog of the inline-workflow and
      // bundle-member resolution the gate already proves, so a role or step can
      // never point at an agent the bundle doesn't ship (the "not found at run
      // time, invisible at build time" class).
      const available = new Set(
        agents.map(({ file }) => file.replace(/\.json$/, '')),
      );
      const refs = new Set<string>();
      for (const roleTarget of Object.values(roles ?? {})) refs.add(roleTarget);
      for (const declared of declaredAgentSlugs ?? []) refs.add(declared);
      for (const step of workflow?.steps ?? []) {
        const config = step.config;
        if (config.type !== 'agent') continue;
        const params = config.parameters;
        if (
          params &&
          typeof params === 'object' &&
          'agentSlug' in params &&
          typeof params.agentSlug === 'string'
        ) {
          refs.add(params.agentSlug);
        }
      }
      const missing = [...refs].filter((ref) => {
        const name = ref.includes('/')
          ? ref.slice(ref.lastIndexOf('/') + 1)
          : ref;
        return !available.has(name);
      });
      expect(missing, `unresolved agent refs: ${missing.join(', ')}`).toEqual(
        [],
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Installation-bundle shape gate (`bundle.members`) — not to be confused with
// an app BUNDLE (the whole `automations/<slug>/` dir this file's header talks
// about). An installation bundle ships `bundle.json` (parsed by the strict
// `bundleManifestSchema`) declaring `bundle.members`: installing it installs
// each member through one aggregated wizard
// (`convex/automations/install_bundle_actions.ts`). It ships no install-bearing
// fields of its own (the schema forbids them), and every declared member must
// exist, be `hidden: true`, and share the bundle's scope — the SAME rule set
// `validateBundleShape` enforces at install time, so a bundle that passes here
// is guaranteed to install cleanly and vice versa.
//
// `resolve-github-issues` is the first real installation bundle (four hidden
// member automations: triage-github-issues, sync-github-issues,
// create-github-pr, review-github-pr): the `it.each` below gates it (and any
// future bundle) automatically by discovery; the synthetic fixture right
// after it (constructed in-memory, never written to `builtin-configs/`)
// proves the helper actually catches every violation kind.
// ---------------------------------------------------------------------------

const installationBundleSlugs = automationSlugs.filter((slug) =>
  isBundleAppDir(join(AUTOMATIONS_DIR, slug)),
);

describe('installation-bundle shape gate (validateBundleShape)', () => {
  it.each(installationBundleSlugs)(
    'bundle "%s" resolves cleanly through validateBundleShape',
    (slug) => {
      const bundle = bundleManifestSchema.parse(
        readJson(join(AUTOMATIONS_DIR, slug, 'bundle.json')),
      );
      const members = new Map(
        bundle.bundle.members.map((memberSlug) => {
          const memberManifestPath = join(
            AUTOMATIONS_DIR,
            memberSlug,
            'automation.json',
          );
          const member = existsSync(memberManifestPath)
            ? automationManifestSchema.parse(readJson(memberManifestPath))
            : null;
          return [memberSlug, member] as const;
        }),
      );
      expect(validateBundleShape(slug, bundle, members)).toEqual([]);
    },
  );

  it('flags every violation kind on a synthetic bundle (fixture-only, never shipped)', () => {
    // Built by hand, not via `bundleManifestSchema` — that strict schema would
    // REJECT the install-bearing `workflows` field at parse time, so the
    // `HAS_INSTALL_FIELDS` defense in `validateBundleShape` is exercised with a
    // raw shape the way an unvalidated caller could still hand it in.
    const bundle = {
      scope: 'org' as const,
      // Violation: a bundle must carry no install-bearing fields of its own.
      workflows: ['own-workflow'],
      bundle: { members: ['synthetic-member', 'ghost-member'] },
    };
    const members = new Map([
      [
        'synthetic-member',
        // Violation: exists but not `hidden: true`.
        automationManifestSchema.parse({
          name: 'Synthetic member',
          scope: 'org',
        }),
      ],
      // Violation: declared but unresolvable.
      ['ghost-member', null],
    ] as const);

    const errors = validateBundleShape('synthetic-bundle', bundle, members);
    expect(errors.map((e) => e.code).sort()).toEqual(
      ['HAS_INSTALL_FIELDS', 'MEMBER_MISSING', 'MEMBER_NOT_HIDDEN'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// "Resolve GitHub issues" specifics — behavioral pins beyond the generic
// bundle gate, for the bundle manifest and its four hidden members.
// ---------------------------------------------------------------------------

const BUNDLE_DIR = join(AUTOMATIONS_DIR, 'resolve-github-issues');
const readBundleJson = (rel: string): unknown =>
  JSON.parse(readFileSync(resolve(BUNDLE_DIR, rel), 'utf8'));
const readMemberJson = (memberSlug: string, rel: string): unknown =>
  JSON.parse(readFileSync(resolve(AUTOMATIONS_DIR, memberSlug, rel), 'utf8'));

describe('"Resolve GitHub issues" bundle (data) — desk-specific pins', () => {
  const bundle = bundleManifestSchema.parse(readBundleJson('bundle.json'));

  it('the bundle manifest is visible and declares its four hidden members', () => {
    expect(bundle.name).toBe('Resolve GitHub issues');
    // The strict `bundleManifestSchema` forbids `hidden` — a bundle is always
    // the visible catalog entry, never a hidden member.
    expect('hidden' in bundle).toBe(false);
    expect(bundle.scope).toBe('project');
    // The manifest translates itself via an inline `i18n` block — no
    // per-bundle message catalog.
    expect(bundle.i18n?.de?.name).toBe('GitHub-Issues lösen');
    expect(bundle.i18n?.fr?.name).toBe('Résoudre les issues GitHub');
    expect(bundle.bundle.members).toEqual([
      'triage-github-issues',
      'sync-github-issues',
      'create-github-pr',
      'review-github-pr',
    ]);
    // Bundles carry no install-bearing fields of their own (the strict schema
    // rejects them at parse time — asserted here as absence).
    expect('workflows' in bundle).toBe(false);
    expect('agents' in bundle).toBe(false);
    expect('requires' in bundle).toBe(false);
  });

  it.each(bundle.bundle.members)(
    'member "%s" is hidden, project-scoped, and needs github',
    (memberSlug) => {
      const manifest = automationManifestSchema.parse(
        readMemberJson(memberSlug, 'automation.json'),
      );
      expect(manifest.hidden, `${memberSlug} hidden`).toBe(true);
      expect(manifest.scope, `${memberSlug} scope`).toBe('project');
      expect(
        manifest.requires?.integrations,
        `${memberSlug} requires.integrations`,
      ).toContain('github');
      expect(existsSync(join(AUTOMATIONS_DIR, memberSlug, 'views'))).toBe(
        false,
      );
    },
  );

  it('ships no views and no function allowlist on any member — the project Backlog + Runs own the surface', () => {
    for (const memberSlug of bundle.bundle.members) {
      const manifest = automationManifestSchema.parse(
        readMemberJson(memberSlug, 'automation.json'),
      );
      expect(manifest.capabilities?.functions, memberSlug).toBeUndefined();
    }
  });

  it('create-github-pr and review-github-pr ship a durable-sandbox BYO agent', () => {
    for (const [memberSlug, agentName] of [
      ['create-github-pr', 'pr-creator'],
      ['review-github-pr', 'pr-reviewer'],
    ] as const) {
      const cfg = agentJsonSchema.parse(
        readMemberJson(memberSlug, `agents/${agentName}.json`),
      );
      expect(cfg.primaryBehavior, `${agentName} primaryBehavior`).toBe(
        'external-agent',
      );
      expect(cfg.authMode, `${agentName} authMode`).toBe('byo');
      expect(cfg.agentKind, `${agentName} agentKind`).toBe('claude-code');
      // Dispatched via the generic `agent` action's run_on_task — durable
      // sandbox step, never the external tale-daemon runtime.
      expect(cfg.preferDurableStepForTasks, `${agentName} durable`).toBe(true);
      expect(cfg.runtime, `${agentName} runtime`).toBeUndefined();
    }
  });

  it('triage-github-issues and sync-github-issues carry no agent, only a schedule trigger', () => {
    for (const memberSlug of [
      'triage-github-issues',
      'sync-github-issues',
    ] as const) {
      const manifest = automationManifestSchema.parse(
        readMemberJson(memberSlug, 'automation.json'),
      );
      expect(manifest.agents ?? [], memberSlug).toEqual([]);
      const workflow = manifest.workflow;
      expect(workflow, `${memberSlug} inline workflow`).toBeDefined();
      expect(
        (workflow?.triggers?.schedules ?? []).length,
        `${memberSlug} schedule`,
      ).toBeGreaterThan(0);
      expect(
        workflow?.triggers?.events,
        `${memberSlug} events`,
      ).toBeUndefined();
    }
  });

  it("create-github-pr's workflow runs pr-creator via the generic agent action (run_on_task)", () => {
    const workflow = automationManifestSchema.parse(
      readMemberJson('create-github-pr', 'automation.json'),
    ).workflow;
    const steps = (workflow?.steps ?? []) as Array<Record<string, unknown>>;
    const run = steps.find((s) => s.stepSlug === 'run') as {
      stepType?: string;
      config?: {
        type?: string;
        parameters?: { operation?: string; agentSlug?: string };
      };
    };
    expect(run.stepType).toBe('action');
    expect(run.config?.type).toBe('agent');
    expect(run.config?.parameters?.operation).toBe('run_on_task');
    expect(run.config?.parameters?.agentSlug).toBe(
      'create-github-pr/pr-creator',
    );
  });

  it('review-github-pr polls in_review tasks assigned to pr-creator and bounds its rework loop by a task label', () => {
    const workflow = automationManifestSchema.parse(
      readMemberJson('review-github-pr', 'automation.json'),
    ).workflow;
    const steps = (workflow?.steps ?? []) as Array<Record<string, unknown>>;
    const bySlug = (slug: string) => steps.find((s) => s.stepSlug === slug);

    const list = bySlug('list_candidates') as {
      config?: {
        parameters?: { operation?: string; assigneeId?: string };
      };
    };
    expect(list.config?.parameters?.operation).toBe('list_open_for_assignee');
    expect(list.config?.parameters?.assigneeId).toBe(
      'create-github-pr/pr-creator',
    );

    // Not approved routes through the label-backed tier count, never straight
    // back to a rework step — the rework budget is enforced, not advisory.
    const judgeDecision = bySlug('judge_decision') as {
      nextSteps?: Record<string, string>;
    };
    expect(judgeDecision.nextSteps?.false).toBe('compute_rework_tier');

    const budgetCheck = bySlug('rework_budget_check') as {
      stepType?: string;
      config?: { expression?: string };
      nextSteps?: Record<string, string>;
    };
    expect(budgetCheck.stepType).toBe('condition');
    expect(budgetCheck.config?.expression).toContain('variables.reworkTier');
    expect(budgetCheck.config?.expression).toContain('config.maxReworkLoops');
    expect(budgetCheck.nextSteps?.true).toBe('budget_exhausted_comment');
    expect(budgetCheck.nextSteps?.false).toBe('bump_rework_label');

    const reassign = bySlug('reassign_to_creator') as {
      config?: { parameters?: { assigneeId?: string } };
    };
    expect(reassign.config?.parameters?.assigneeId).toBe(
      'create-github-pr/pr-creator',
    );
  });
});
