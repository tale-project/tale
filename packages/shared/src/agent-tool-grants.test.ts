import { describe, expect, it } from 'vitest';

import { normalizeToolGrants, WRITE_EFFECT_TOOLS } from './agent-tool-grants';

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
