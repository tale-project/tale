/**
 * Proves the on-disk issue-resolution demo APP (builtin-configs/apps/
 * issue-desk) is well-formed against the platform skeleton — the "new app =
 * data" litmus: the manifest composes the workflow + agents by reference, the
 * workflow validates, the view is a Puck Data document whose bound functions are
 * all declared in the app's `capabilities.functions` allowlist, and its labels
 * pass the cross-locale check — with zero per-vertical system code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  collectViewBindings,
  validateViewBindings,
} from '../../../../lib/shared/platform/function_bindings';
import {
  collectViewLabelKeys,
  collectWorkflowLabelKeys,
  findMissingLabelKeys,
} from '../../../../lib/shared/platform/label_completeness';
import { agentJsonSchema } from '../../../../lib/shared/schemas/agents';
import { appManifestSchema } from '../../../../lib/shared/schemas/apps';
import { workflowJsonSchema } from '../../../../lib/shared/schemas/workflows';
import { validateWorkflowDefinition } from './validate_workflow_definition';

const APP_DIR = fileURLToPath(
  new URL(
    '../../../../../../builtin-configs/apps/issue-desk/',
    import.meta.url,
  ),
);
const read = (rel: string) => readFileSync(resolve(APP_DIR, rel), 'utf8');
const readJson = (rel: string): unknown => JSON.parse(read(rel));

describe('issue-desk demo app (data) validates against the skeleton', () => {
  const manifest = appManifestSchema.parse(readJson('app.json'));
  const workflow = workflowJsonSchema.safeParse(
    readJson('workflows/issue-desk/desk-process.json'),
  );
  const view = readJson('views/desk.json') as {
    tabs?: Array<{
      id?: string;
      data?: {
        content?: Array<{ type?: string; props?: Record<string, unknown> }>;
      };
    }>;
  };

  const blocks = (view.tabs ?? []).flatMap((tab) => tab.data?.content ?? []);
  const blockOfType = (type: string) => blocks.find((b) => b.type === type);

  it('app.json manifest composes the workflow + agents + functions by reference', () => {
    expect(manifest.name).toBe('Issue resolution desk');
    expect(manifest.messageNamespace).toBe('issueDesk');
    // The desk binds to one project at install (its tasks/runs live there).
    expect(manifest.scope).toBe('project');
    expect(manifest.workflows).toContain('issue-desk/desk-process');
    // Agents are referenced BARE in the manifest (their on-disk filename); the
    // app-owned IDENTITY is the COMPOSITE slug `<app>/<name>`, used wherever an
    // agent is resolved at runtime — the roles map, workflow steps, env keys.
    expect(manifest.agents).toContain('desk-implementer');
    expect(manifest.roles?.implementer).toBe('issue-desk/desk-implementer');
    expect(manifest.capabilities?.roles).toEqual(
      expect.arrayContaining([
        'issue-desk/desk-implementer',
        'issue-desk/desk-reviewer',
      ]),
    );
    const fnPaths = manifest.capabilities?.functions?.map((f) => f.path) ?? [];
    expect(fnPaths).toContain('tasks/queries:listTasksByProject');
    // App agents are listed via the app-scoped action; the global `listAgents`
    // would never return them.
    expect(fnPaths).toContain('agents/file_actions:listAppAgents');
    expect(fnPaths).not.toContain('agents/file_actions:listAgents');
  });

  it('workflow parses + passes validateWorkflowDefinition (ui/role annotations)', () => {
    expect(workflow.success).toBe(true);
    if (!workflow.success) return;
    const result = validateWorkflowDefinition(
      { name: workflow.data.name },
      workflow.data.steps as Array<Record<string, unknown>>,
    );
    expect(result.errors).toEqual([]);
  });

  it('view is a tabbed shell with the expected areas', () => {
    const ids = (view.tabs ?? []).map((tab) => tab.id);
    expect(ids).toEqual(['issues', 'tasks']);
  });

  it('every function the view binds (across tabs + columns) is allowlisted', () => {
    const collected = collectViewBindings(view);
    // Sanity: bindings are actually discovered across the tab/column layout.
    expect(collected.length).toBeGreaterThan(0);
    // The ExternalList's action-sourced data path (`source`) AND its per-row
    // materialize action are both collected — not only reactive `query` blocks.
    const paths = collected.map((b) => b.path);
    expect(paths).toContain('integrations/public_actions:listGitHubIssues');
    expect(paths).toContain('tasks/public_actions:createTaskFromExternalIssue');
    // The Tasks-board "Start" (re-)triggers the workflow on the task — not a bare
    // status write — so the run is re-launchable after a failure.
    expect(paths).toContain('tasks/public_actions:startTaskWorkflow');
    const errors = validateViewBindings(view, manifest.capabilities?.functions);
    expect(errors).toEqual([]);
  });

  it('the Issues list hides already-created issues via an allowlisted cross-ref', () => {
    const issues = blockOfType('ExternalList');
    const excludeBy = issues?.props?.excludeBy as
      | {
          query?: { path?: string };
          refField?: string;
          rowKeyTemplate?: string;
        }
      | undefined;
    // Cross-references tasks by their externalId, rebuilt from the issue row with
    // the same template the materialize action uses to write it.
    expect(excludeBy?.query?.path).toBe('tasks/queries:listTasksByProject');
    expect(excludeBy?.refField).toBe('externalId');
    expect(excludeBy?.rowKeyTemplate).toBe('tale-project/tale#{number}');
    // The cross-ref query is collected (so publish-time validation covers it)
    // and is in the allowlist.
    const paths = collectViewBindings(view).map((b) => b.path);
    expect(paths).toContain('tasks/queries:listTasksByProject');
    expect(
      validateViewBindings(view, manifest.capabilities?.functions),
    ).toEqual([]);
  });

  it('workflow passes the cross-locale label consistency check (en/de/fr)', () => {
    expect(workflow.success).toBe(true);
    if (!workflow.success) return;
    const catalogs = {
      en: readJson('messages/en.json') as Record<string, string>,
      de: readJson('messages/de.json') as Record<string, string>,
      fr: readJson('messages/fr.json') as Record<string, string>,
    };
    const referenced = collectWorkflowLabelKeys({ steps: workflow.data.steps });
    const missing = findMissingLabelKeys(referenced, catalogs, [
      'en',
      'de',
      'fr',
    ]);
    expect(missing).toEqual([]);
  });

  it('Tasks board drops the internal externalId marker column', () => {
    const collection = blockOfType('Collection');
    const columns = collection?.props?.columns;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns).not.toContain('externalId');
  });

  it('has no org-wide approvals ReviewQueue (it leaked unrelated approvals)', () => {
    expect(blockOfType('ReviewQueue')).toBeUndefined();
    const fnPaths = manifest.capabilities?.functions?.map((f) => f.path) ?? [];
    expect(fnPaths).not.toContain(
      'approvals/queries:listActiveApprovalsByOrganization',
    );
  });

  it('quick-create uses a localized task-description template in every locale', () => {
    // The materialize action's `description` arg points at a pack `labelKey` via
    // the `$label:` binding form; resolve it back to the catalog key.
    const issues = blockOfType('ExternalList');
    const actions = issues?.props?.actions as
      | Array<{ args?: { description?: unknown } }>
      | undefined;
    const desc = actions?.[0]?.args?.description;
    expect(typeof desc).toBe('string');
    expect((desc as string).startsWith('$label:')).toBe(true);
    const key = (desc as string).slice('$label:'.length);
    // The workflow label check only covers keys a WORKFLOW step references; this
    // one is read at runtime by the view, so guard its cross-locale parity here.
    for (const locale of ['en', 'de', 'fr']) {
      const catalog = readJson(`messages/${locale}.json`) as Record<
        string,
        string
      >;
      const template = catalog[key];
      expect(template, `${locale} ${key}`).toBeTruthy();
      // The placeholders the resolver fills from the row must be present — note
      // raw GitHub field names, since `$label:` interpolates over the row.
      for (const ph of ['{title}', '{number}', '{html_url}']) {
        expect(template, `${locale} ${ph}`).toContain(ph);
      }
    }
  });

  it('every $label: the view authors (title/tabs/list titles/columns) resolves in en/de/fr', () => {
    const catalogs = {
      en: readJson('messages/en.json') as Record<string, string>,
      de: readJson('messages/de.json') as Record<string, string>,
      fr: readJson('messages/fr.json') as Record<string, string>,
    };
    const referenced = collectViewLabelKeys(view);
    // Sanity: the view now authors its display strings as pack references (the
    // bug was these being raw English literals that never hit the catalog).
    expect(referenced).toEqual(
      expect.arrayContaining([
        'issueDesk.deskTitle',
        'issueDesk.deskDescription',
        'issueDesk.tab.issues',
        'issueDesk.tab.tasks',
        'issueDesk.issuesListTitle',
        'issueDesk.tasksListTitle',
        'issueDesk.col.number',
        'issueDesk.col.status',
      ]),
    );
    expect(
      findMissingLabelKeys(referenced, catalogs, ['en', 'de', 'fr']),
    ).toEqual([]);
  });

  it("the Tasks board's row-action labelKeys exist in the platform apps catalog (en/de/fr)", () => {
    // Start / Mark done resolve via `t(action.labelKey)` against the PLATFORM
    // `apps` namespace (generic chrome), not the pack catalog — so guard those.
    const platformMessagesDir = fileURLToPath(
      new URL('../../../../messages/', import.meta.url),
    );
    for (const locale of ['en', 'de', 'fr']) {
      const msgs = JSON.parse(
        readFileSync(resolve(platformMessagesDir, `${locale}.json`), 'utf8'),
      ) as { apps?: { list?: Record<string, string> } };
      for (const key of ['start', 'markDone']) {
        expect(
          msgs.apps?.list?.[key],
          `${locale} apps.list.${key}`,
        ).toBeTruthy();
      }
    }
  });

  it('the role agents are valid external-agent + BYO sandbox configs', () => {
    for (const slug of ['desk-implementer', 'desk-reviewer']) {
      const cfg = agentJsonSchema.parse(readJson(`agents/${slug}.json`));
      // Every desk agent runs as Claude Code in a sandbox on the user's own
      // credentials.
      expect(cfg.primaryBehavior, `${slug} primaryBehavior`).toBe(
        'external-agent',
      );
      expect(cfg.authMode, `${slug} authMode`).toBe('byo');
      expect(cfg.agentKind, `${slug} agentKind`).toBe('claude-code');
      // They run in the PLATFORM's own ephemeral sandbox (the `sandbox` step's
      // `run.agent`), NOT an external tale-daemon — so they carry NO `runtime`.
      expect(cfg.runtime, `${slug} runtime`).toBeUndefined();
    }
  });

  it('the agent steps run named agents in the platform sandbox (sandbox/run.agent)', () => {
    expect(workflow.success).toBe(true);
    if (!workflow.success) return;
    const steps = workflow.data.steps as Array<Record<string, unknown>>;
    for (const slug of ['implement', 'review']) {
      const step = steps.find((s) => s.stepSlug === slug);
      expect(step?.stepType, `${slug} stepType`).toBe('sandbox');
      const run = (
        step?.config as {
          run?: { agent?: string; budget?: { maxCents?: number } };
        }
      )?.run;
      expect(typeof run?.agent, `${slug} run.agent is a string`).toBe('string');
      expect(run?.budget?.maxCents ?? 0, `${slug} budget`).toBeGreaterThan(0);
    }
    // The roles the steps template against resolve to the app-scoped composite.
    const vars = workflow.data.config?.variables as
      | { roles?: Record<string, string> }
      | undefined;
    expect(vars?.roles?.implementer).toBe('issue-desk/desk-implementer');
  });

  it('the review->implement rework loop is bounded by a configurable counter', () => {
    expect(workflow.success).toBe(true);
    if (!workflow.success) return;
    const steps = workflow.data.steps as Array<Record<string, unknown>>;
    const bySlug = (slug: string) => steps.find((s) => s.stepSlug === slug);

    // A tunable default cap lives in config.variables (operators adjust it).
    const vars = workflow.data.config?.variables as
      | { maxReworkLoops?: unknown }
      | undefined;
    expect(typeof vars?.maxReworkLoops).toBe('number');
    expect(vars?.maxReworkLoops as number).toBeGreaterThan(0);

    // The judge's "needs work" branch must NOT loop straight back to the
    // implementer — it routes through the counter so it can't run forever.
    const judge = bySlug('judge_decision') as {
      nextSteps?: Record<string, string>;
    };
    expect(judge.nextSteps?.false).toBe('bump_rework');

    // bump_rework increments reworkCount via set_variables.
    const bump = bySlug('bump_rework') as {
      stepType?: string;
      config?: {
        type?: string;
        parameters?: { variables?: Array<{ name?: string }> };
      };
      nextSteps?: Record<string, string>;
    };
    expect(bump.stepType).toBe('action');
    expect(bump.config?.type).toBe('set_variables');
    expect(bump.config?.parameters?.variables?.[0]?.name).toBe('reworkCount');
    expect(bump.nextSteps?.success).toBe('rework_gate');

    // rework_gate compares the counter against the cap, then either loops back
    // to the implementer or escalates — the bound is enforced, not advisory.
    const gate = bySlug('rework_gate') as {
      stepType?: string;
      config?: { expression?: string };
      nextSteps?: Record<string, string>;
    };
    expect(gate.stepType).toBe('condition');
    expect(gate.config?.expression).toContain('variables.reworkCount');
    expect(gate.config?.expression).toContain('config.maxReworkLoops');
    expect(gate.nextSteps?.true).toBe('implement');
    expect(gate.nextSteps?.false).toBe('loops_exhausted');

    // The escalation path comments on the task, then parks it for a human
    // (reuses the existing to_review terminal).
    const exhausted = bySlug('loops_exhausted') as {
      config?: { type?: string; parameters?: { operation?: string } };
      nextSteps?: Record<string, string>;
    };
    expect(exhausted.config?.type).toBe('task');
    expect(exhausted.config?.parameters?.operation).toBe('comment');
    expect(exhausted.nextSteps?.success).toBe('to_review');
  });
});
