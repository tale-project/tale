/**
 * Proves the on-disk issue-resolution demo APP (examples/default/apps/
 * issue-desk) is well-formed against the platform skeleton — the "new app =
 * data" litmus: the app manifest composes the workflow + agents by reference,
 * its workflow + view configs validate, and its ui/view labels pass the
 * cross-locale consistency check — with zero per-vertical system code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validatePack } from '../../../../lib/shared/platform/validate_pack';
import { agentJsonSchema } from '../../../../lib/shared/schemas/agents';
import { appManifestSchema } from '../../../../lib/shared/schemas/apps';
import { viewConfigSchema } from '../../../../lib/shared/schemas/views';
import { workflowJsonSchema } from '../../../../lib/shared/schemas/workflows';
import { validateWorkflowDefinition } from './validate_workflow_definition';

// Resolve the repo-root demo app relative to THIS test file (cwd-independent).
const APP_DIR = fileURLToPath(
  new URL(
    '../../../../../../examples/default/apps/issue-desk/',
    import.meta.url,
  ),
);
const read = (rel: string) => readFileSync(resolve(APP_DIR, rel), 'utf8');
const readJson = (rel: string): unknown => JSON.parse(read(rel));

describe('issue-desk demo app (data) validates against the skeleton', () => {
  const workflow = workflowJsonSchema.safeParse(
    readJson('workflows/issue-desk/desk-process.json'),
  );
  const view = viewConfigSchema.safeParse(readJson('views/desk.json'));

  it('app.json manifest composes the workflow + agents by reference', () => {
    const manifest = appManifestSchema.parse(readJson('app.json'));
    expect(manifest.name).toBe('Issue resolution desk');
    expect(manifest.messageNamespace).toBe('issueDesk');
    expect(manifest.workflows).toContain('issue-desk/desk-process');
    expect(manifest.agents).toContain('desk-implementer');
    expect(manifest.roles?.coordinator).toBe('desk-coordinator');
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

  it('view config parses (render-kinds + data-sources)', () => {
    expect(view.success).toBe(true);
  });

  it('app passes the cross-locale consistency check (workflow + views, en/de/fr)', () => {
    expect(workflow.success && view.success).toBe(true);
    if (!workflow.success || !view.success) return;
    const catalogs = {
      en: readJson('messages/en.json') as Record<string, string>,
      de: readJson('messages/de.json') as Record<string, string>,
      fr: readJson('messages/fr.json') as Record<string, string>,
    };
    const result = validatePack({
      workflows: [{ name: workflow.data.name, steps: workflow.data.steps }],
      views: [view.data],
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
