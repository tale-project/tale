/**
 * Proves the on-disk issue-resolution demo pack (examples/default/skills/
 * issue-desk) is well-formed against the platform skeleton — the "new app =
 * data" litmus: the pack's workflow parses, validates, and its ui annotations +
 * Tier-2 labels pass the cross-locale consistency check, with zero per-vertical
 * system code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validatePack } from '../../../../lib/shared/platform/validate_pack';
import { agentJsonSchema } from '../../../../lib/shared/schemas/agents';
import { parseSkillMd } from '../../../../lib/shared/schemas/skills';
import { workflowJsonSchema } from '../../../../lib/shared/schemas/workflows';
import { validateWorkflowDefinition } from './validate_workflow_definition';

// Resolve the repo-root demo pack relative to THIS test file (cwd-independent).
const PACK_DIR = fileURLToPath(
  new URL(
    '../../../../../../examples/default/skills/issue-desk/',
    import.meta.url,
  ),
);
const read = (rel: string) => readFileSync(resolve(PACK_DIR, rel), 'utf8');
const readJson = (rel: string): unknown => JSON.parse(read(rel));

describe('issue-desk demo pack (data) validates against the skeleton', () => {
  // The pack's workflow lives in the standard top-level workflows/ tree (so the
  // platform can discover, install, and execute it); the skill bundles only the
  // messages + scripts. Read it from there, not from inside the skill dir.
  const parsed = workflowJsonSchema.safeParse(
    readJson('../../workflows/issue-desk/desk-process.json'),
  );

  it('workflow parses against workflowJsonSchema', () => {
    expect(parsed.success).toBe(true);
  });

  it('workflow passes validateWorkflowDefinition (incl. ui/role annotations)', () => {
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const result = validateWorkflowDefinition(
      { name: parsed.data.name },
      parsed.data.steps as Array<Record<string, unknown>>,
    );
    expect(result.errors).toEqual([]);
  });

  it('pack passes the cross-locale consistency check (en/de/fr complete)', () => {
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const catalogs = {
      en: readJson('messages/en.json') as Record<string, string>,
      de: readJson('messages/de.json') as Record<string, string>,
      fr: readJson('messages/fr.json') as Record<string, string>,
    };
    const result = validatePack({
      workflows: [{ name: parsed.data.name, steps: parsed.data.steps }],
      catalogs,
      baseLocales: ['en', 'de', 'fr'],
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('SKILL.md declares the pack manifest', () => {
    const { meta } = parseSkillMd(read('SKILL.md'));
    expect(meta.pack?.messageNamespace).toBe('issueDesk');
    expect(meta.pack?.roles).toContain('implementer');
  });

  it('the three role agents are valid agent configs (org-chart delegation)', () => {
    for (const slug of [
      'desk-coordinator',
      'desk-implementer',
      'desk-reviewer',
    ]) {
      const res = agentJsonSchema.safeParse(
        readJson(`../../agents/${slug}.json`),
      );
      expect(res.success, `${slug} should parse`).toBe(true);
    }
    // coordinator delegates to the other two (the demo's org chart)
    const coordinator = agentJsonSchema.parse(
      readJson('../../agents/desk-coordinator.json'),
    );
    expect(coordinator.delegates).toEqual([
      'desk-implementer',
      'desk-reviewer',
    ]);
  });
});
