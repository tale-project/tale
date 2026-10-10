import { describe, expect, it } from 'vitest';

import {
  AGENT_TOOL_CATALOG,
  normalizeToolGrants,
  WRITE_EFFECT_TOOLS,
} from './agent-tool-grants';

describe('captured review delegation grants', () => {
  it('requires an explicit project-agent write grant and never grants it to automation', () => {
    expect(WRITE_EFFECT_TOOLS).toContain('task_delegate_review');
    expect(normalizeToolGrants([])).toEqual([]);
    expect(normalizeToolGrants(['task_find', 'task_get'])).toEqual([
      'task_find',
      'task_get',
    ]);
    expect(normalizeToolGrants(['task_delegate_review', 'task_get'])).toEqual([
      'task_get',
      'task_delegate_review',
    ]);
    expect(
      normalizeToolGrants(['task_delegate_review', 'task_get'], 'automation'),
    ).toEqual(['task_get']);
  });
});

describe('the knowledge-entry write grant', () => {
  it('is a write of the knowledge module, ordered after its find, on both lanes', () => {
    const knowledge = AGENT_TOOL_CATALOG.filter(
      (tool) => tool.module === 'knowledge',
    ).map((tool) => [tool.name, tool.effect]);
    expect(knowledge).toEqual([
      ['knowledge_entry_find', 'read'],
      ['knowledge_entry_write', 'write'],
    ]);
    expect(WRITE_EFFECT_TOOLS).toContain('knowledge_entry_write');
    expect(
      normalizeToolGrants(['knowledge_entry_write', 'knowledge_entry_find']),
    ).toEqual(['knowledge_entry_find', 'knowledge_entry_write']);
    expect(
      normalizeToolGrants(['knowledge_entry_write'], 'automation'),
    ).toEqual(['knowledge_entry_write']);
  });
});
