import { describe, expect, it } from 'vitest';

import { WORKFLOW_SKILL_NAMES } from '../../lib/skills/guidance';
import { customBoundSlugs, planBoundOrgSkillPrune } from './bound_org_skills';
import {
  BAKED_BUILTIN_SKILL_NAMES,
  INTEGRATION_SKILL_PREFIX,
} from './integration_skills';

describe('customBoundSlugs', () => {
  it('filters workflow slugs and invalid names', () => {
    expect(
      customBoundSlugs(['fix-bug', 'my-skill', 'write-notes', '../bad', 'pdf']),
    ).toEqual(['my-skill', 'pdf']);
  });

  it('filters baked builtin names so a bound skill never clobbers the image-baked copy', () => {
    // Mirrors planBoundOrgSkillPrune's baked guard: stage side and prune side
    // must agree, or a bound 'visual-aspect-analyzer' would be staged over
    // the symlinked image copy and then never pruned.
    expect(customBoundSlugs(['visual-aspect-analyzer', 'pdf'])).toEqual([
      'pdf',
    ]);
  });

  it('returns empty when bindings are absent or empty', () => {
    expect(customBoundSlugs(undefined)).toEqual([]);
    expect(customBoundSlugs([])).toEqual([]);
  });
});

describe('planBoundOrgSkillPrune', () => {
  it('prunes stale custom dirs but keeps integration, workflow, and baked skills', () => {
    const staged = new Set([
      `${INTEGRATION_SKILL_PREFIX}github`,
      'fix-bug',
      'visual-aspect-analyzer',
      'pdf',
      'docx',
    ]);
    const toPrune = planBoundOrgSkillPrune({
      stagedDirNames: staged,
      allowedCustomSlugs: new Set(['pdf']),
    });
    expect(toPrune).toEqual(['docx']);
    expect(BAKED_BUILTIN_SKILL_NAMES.has('visual-aspect-analyzer')).toBe(true);
    expect(WORKFLOW_SKILL_NAMES).toContain('fix-bug');
  });

  it('prunes nothing when every custom dir is still allowed', () => {
    expect(
      planBoundOrgSkillPrune({
        stagedDirNames: new Set(['pdf', 'docx']),
        allowedCustomSlugs: new Set(['pdf', 'docx']),
      }),
    ).toEqual([]);
  });
});
