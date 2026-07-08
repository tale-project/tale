import { describe, expect, it } from 'vitest';

import type { SkillRuntimeEntry } from '../../lib/agent_chat/skills_runtime';
import type { ToolAvailability } from '../types';
import {
  describeNarrowing,
  resolveJobSpec,
  WORKER_BASELINE_TOOLS,
  WORKER_WORKSPACE_READ_TOOLS,
} from './resolve_job_spec';

const IMPLICIT_TOOLS = [
  ...WORKER_BASELINE_TOOLS,
  ...WORKER_WORKSPACE_READ_TOOLS,
];

const AVAILABILITY = new Map<string, ToolAvailability>([
  ['web', 'any'],
  ['rag_search', 'any'],
  ['file_write', 'any'],
  ['request_human_input', 'primary-only'],
  ['update_todos', 'primary-only'],
]);

function skillEntry(slug: string): SkillRuntimeEntry {
  return {
    slug,
    description: `skill ${slug}`,
    disableModelInvocation: false,
    body: `# ${slug} methodology`,
    versionHashLive: `hash-${slug}`,
    files: [],
  };
}

const PARENT = {
  toolNames: ['web', 'rag_search', 'request_human_input', 'update_todos'],
  skillBindings: ['deep-research', 'pdf'],
  integrationBindings: ['tavily'],
};

const SKILLS = new Map([
  ['deep-research', skillEntry('deep-research')],
  ['pdf', skillEntry('pdf')],
]);

describe('resolveJobSpec', () => {
  it('grants the intersection plus the worker baseline and workspace reads', () => {
    const result = resolveJobSpec({
      requested: { tools: ['web', 'rag_search'] },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.effectiveTools).toEqual([
      ...IMPLICIT_TOOLS,
      'web',
      'rag_search',
    ]);
    expect(describeNarrowing(result.narrowed)).toBe('');
  });

  it('grants workspace read tools even when nothing was requested and the parent lacks them', () => {
    const result = resolveJobSpec({
      requested: { tools: [] },
      parent: PARENT, // parent holds neither file_read nor file_list
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.effectiveTools).toEqual(IMPLICIT_TOOLS);
    expect(describeNarrowing(result.narrowed)).toBe('');
  });

  it('treats a request for an implicit tool as a no-op, not a narrowing or duplicate', () => {
    const result = resolveJobSpec({
      requested: {
        tools: ['file_read', 'file_list', 'update_progress', 'web'],
      },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.effectiveTools).toEqual([...IMPLICIT_TOOLS, 'web']);
    expect(result.narrowed.tools).toEqual([]);
  });

  it('strips primary-only tools even when the parent holds them', () => {
    const result = resolveJobSpec({
      requested: { tools: ['web', 'request_human_input', 'update_todos'] },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.effectiveTools).toEqual([...IMPLICIT_TOOLS, 'web']);
    expect(result.narrowed.tools).toEqual([
      'request_human_input',
      'update_todos',
    ]);
  });

  it('narrows tools outside the parent boundary', () => {
    const result = resolveJobSpec({
      requested: { tools: ['file_write', 'web'] },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    // file_write is registry-'any' but the PARENT doesn't hold it.
    expect(result.narrowed.tools).toEqual(['file_write']);
    expect(result.effectiveTools).toContain('web');
  });

  it('resolves the methodology from the parent snapshot and freezes body+hash', () => {
    const result = resolveJobSpec({
      requested: { tools: ['web'], methodology: 'deep-research' },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.methodology).toEqual({
      slug: 'deep-research',
      body: '# deep-research methodology',
      versionHash: 'hash-deep-research',
    });
  });

  it('narrows an ungranted or unknown methodology and skills/integrations', () => {
    const result = resolveJobSpec({
      requested: {
        tools: ['web'],
        methodology: 'not-bound',
        skills: ['pdf', 'ghost'],
        integrations: ['tavily', 'slack'],
      },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.methodology).toBeUndefined();
    expect(result.narrowed.methodology).toBe('not-bound');
    expect(result.skills).toEqual(['pdf']);
    expect(result.narrowed.skills).toEqual(['ghost']);
    expect(result.integrations).toEqual(['tavily']);
    expect(result.narrowed.integrations).toEqual(['slack']);
    expect(describeNarrowing(result.narrowed)).toContain(
      'methodology: not-bound',
    );
  });

  it('dedupes repeated requests', () => {
    const result = resolveJobSpec({
      requested: { tools: ['web', 'web'] },
      parent: PARENT,
      availability: AVAILABILITY,
      skillsBySlug: SKILLS,
    });
    expect(result.effectiveTools.filter((t) => t === 'web')).toHaveLength(1);
  });
});
