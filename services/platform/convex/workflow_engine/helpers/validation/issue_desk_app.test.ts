/**
 * Proves the on-disk issue-resolution demo APP (examples/default/apps/
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

import { validateViewBindings } from '../../../../lib/shared/platform/function_bindings';
import { validatePack } from '../../../../lib/shared/platform/validate_pack';
import { agentJsonSchema } from '../../../../lib/shared/schemas/agents';
import { appManifestSchema } from '../../../../lib/shared/schemas/apps';
import { workflowJsonSchema } from '../../../../lib/shared/schemas/workflows';
import { validateWorkflowDefinition } from './validate_workflow_definition';

const APP_DIR = fileURLToPath(
  new URL(
    '../../../../../../examples/default/apps/issue-desk/',
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
    data?: { content?: Array<{ type?: string }> };
  };

  it('app.json manifest composes the workflow + agents + functions by reference', () => {
    expect(manifest.name).toBe('Issue resolution desk');
    expect(manifest.messageNamespace).toBe('issueDesk');
    expect(manifest.workflows).toContain('issue-desk/desk-process');
    expect(manifest.agents).toContain('desk-implementer');
    expect(manifest.roles?.coordinator).toBe('desk-coordinator');
    expect(manifest.capabilities?.functions?.map((f) => f.path)).toContain(
      'tasks/queries:listTasksByOrg',
    );
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

  it('view is a Puck Data document with connected blocks', () => {
    const types = (view.data?.content ?? []).map((n) => n.type);
    expect(types).toContain('Collection');
    expect(types).toContain('ReviewQueue');
  });

  it('every function the view binds is in capabilities.functions (allowlist)', () => {
    const errors = validateViewBindings(view, manifest.capabilities?.functions);
    expect(errors).toEqual([]);
  });

  it('workflow passes the cross-locale label consistency check (en/de/fr)', () => {
    expect(workflow.success).toBe(true);
    if (!workflow.success) return;
    const catalogs = {
      en: readJson('messages/en.json') as Record<string, string>,
      de: readJson('messages/de.json') as Record<string, string>,
      fr: readJson('messages/fr.json') as Record<string, string>,
    };
    const result = validatePack({
      workflows: [{ name: workflow.data.name, steps: workflow.data.steps }],
      catalogs,
      baseLocales: ['en', 'de', 'fr'],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('the three role agents are valid configs (org-chart delegation)', () => {
    for (const slug of [
      'desk-coordinator',
      'desk-implementer',
      'desk-reviewer',
    ]) {
      const res = agentJsonSchema.safeParse(readJson(`agents/${slug}.json`));
      expect(res.success, `${slug} should parse`).toBe(true);
    }
    const coordinator = agentJsonSchema.parse(
      readJson('agents/desk-coordinator.json'),
    );
    expect(coordinator.delegates).toEqual([
      'desk-implementer',
      'desk-reviewer',
    ]);
  });
});
