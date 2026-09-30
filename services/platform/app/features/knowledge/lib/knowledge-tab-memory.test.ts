// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  persistKnowledgeTabMemory,
  readKnowledgeTabMemory,
} from './knowledge-tab-memory';

beforeEach(() => {
  window.localStorage.clear();
});

describe('knowledge tab memory', () => {
  it('has nothing to read before anything is persisted', () => {
    expect(readKnowledgeTabMemory('org-1')).toBeUndefined();
  });

  it('round-trips a persisted tab', () => {
    persistKnowledgeTabMemory('org-1', 'websites');
    expect(readKnowledgeTabMemory('org-1')).toBe('websites');
  });

  it('scopes the memory per organization', () => {
    persistKnowledgeTabMemory('org-1', 'websites');
    expect(readKnowledgeTabMemory('org-2')).toBeUndefined();
  });

  it('ignores a tab that is not one of the 5 known pages', () => {
    window.localStorage.setItem(
      'tale.platform.knowledge.org-1.lastTab',
      JSON.stringify('not-a-real-tab'),
    );
    expect(readKnowledgeTabMemory('org-1')).toBeUndefined();
  });

  it('ignores corrupted storage rather than throwing', () => {
    window.localStorage.setItem(
      'tale.platform.knowledge.org-1.lastTab',
      '{not json',
    );
    expect(readKnowledgeTabMemory('org-1')).toBeUndefined();
  });
});
