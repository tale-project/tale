// Unit tests for the skills-guidance builder. The section is rendered ONLY
// from the skills actually available in the session — a step must never name
// a skill the agent cannot load — and the text must stay generic (no Tale
// repo paths or commands; it ships into arbitrary product workspaces).

import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildSkillsGuidance,
  SKILLS_GUIDANCE_HEADING,
  WORKFLOW_SKILL_NAMES,
} from './guidance';

const ALL = new Set(WORKFLOW_SKILL_NAMES);

function without(...names: string[]): Set<string> {
  const set = new Set(ALL);
  for (const name of names) set.delete(name);
  return set;
}

describe('buildSkillsGuidance', () => {
  const prev = process.env.TALE_SANDBOX_SKILLS_GUIDANCE;
  afterEach(() => {
    if (prev === undefined) delete process.env.TALE_SANDBOX_SKILLS_GUIDANCE;
    else process.env.TALE_SANDBOX_SKILLS_GUIDANCE = prev;
  });

  it('renders the full ten-step workflow when every skill is available', () => {
    const out = buildSkillsGuidance(ALL);
    expect(out.startsWith(SKILLS_GUIDANCE_HEADING)).toBe(true);
    expect(out).toContain('1. Classify the task');
    expect(out).toContain('-> implement-feature');
    expect(out).toContain('-> fix-bug');
    expect(out).toContain('-> make-improvement');
    expect(out).toContain('2. Write the note first (write-notes)');
    expect(out).toContain('10. Ship the finished change with create-pr.');
    expect(out.match(/^\d+\. /gm)).toHaveLength(10);
    expect(out.endsWith('never skip the note.')).toBe(true);
  });

  it('drops absent steps and renumbers the rest', () => {
    const out = buildSkillsGuidance(
      new Set(['implement-feature', 'write-notes', 'test-code']),
    );
    expect(out).toContain('1. Classify the task');
    expect(out).toContain('-> implement-feature');
    expect(out).not.toContain('fix-bug');
    expect(out).toContain('2. Write the note first');
    expect(out).toContain('3. Prove the behaviour with test-code');
    expect(out.match(/^\d+\. /gm)).toHaveLength(3);
  });

  it('the classify step lists only the available disciplines', () => {
    const out = buildSkillsGuidance(new Set(['fix-bug']));
    expect(out).toContain('-> fix-bug');
    expect(out).not.toContain('implement-feature');
    expect(out).not.toContain('make-improvement');
  });

  it('the classify step is dropped when no discipline skill is available', () => {
    const out = buildSkillsGuidance(new Set(['write-notes']));
    expect(out).not.toContain('Classify the task');
    expect(out).toContain('1. Write the note first');
  });

  it('the UI step degrades to a single-skill sentence', () => {
    const both = buildSkillsGuidance(new Set(['design-ui', 'implement-ui']));
    expect(both).toContain('then build to it with implement-ui');

    const designOnly = buildSkillsGuidance(new Set(['design-ui']));
    expect(designOnly).toContain('before changing it');
    expect(designOnly).not.toContain('implement-ui');

    const implementOnly = buildSkillsGuidance(new Set(['implement-ui']));
    expect(implementOnly).toContain(
      "build to the project's design system with implement-ui",
    );
    expect(implementOnly).not.toContain('design-ui');
  });

  it('the close drops the note clause when write-notes is absent', () => {
    const out = buildSkillsGuidance(without('write-notes'));
    expect(out).not.toContain('never skip the note');
    expect(out.endsWith('does not apply to the task.')).toBe(true);
  });

  it('returns the empty string when no skill is available', () => {
    expect(buildSkillsGuidance(new Set())).toBe('');
  });

  it('returns the empty string under the kill-switch', () => {
    process.env.TALE_SANDBOX_SKILLS_GUIDANCE = '0';
    expect(buildSkillsGuidance(ALL)).toBe('');
  });

  it('is deterministic for a given availability set', () => {
    expect(buildSkillsGuidance(ALL)).toBe(buildSkillsGuidance(ALL));
  });

  it('names no repo-specific tooling and no non-step skills', () => {
    const out = buildSkillsGuidance(ALL);
    // Generic by contract: the section ships into arbitrary product repos.
    expect(out).not.toContain('bun run');
    expect(out).not.toContain('.agents/');
    expect(out).not.toContain('builtin-configs');
    // Staged but deliberately not a numbered step.
    expect(out).not.toContain('review-pr');
  });
});

describe('WORKFLOW_SKILL_NAMES', () => {
  it('every name ships as a builtin-configs workflow skill', async () => {
    // Pins the landing order: the staging allowlist may only name skills that
    // exist as product skill bundles.
    const skillsRoot = fileURLToPath(
      new URL('../../../../../builtin-configs/skills/', import.meta.url),
    );
    const onDisk = await readdir(skillsRoot);
    for (const name of WORKFLOW_SKILL_NAMES) {
      expect(onDisk).toContain(name);
    }
  });
});
