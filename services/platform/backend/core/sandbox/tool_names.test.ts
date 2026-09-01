import { describe, expect, it } from 'vitest';

import {
  AGENT_GRANTABLE_TOOLS,
  grantedToolsGuidance,
  KNOWLEDGE_READ_TOOLS,
  normalizeToolGrants,
  secretsGuidance,
  WRITE_EFFECT_TOOLS,
} from './tool_names';

describe('normalizeToolGrants', () => {
  it('drops unknown names and dedupes to catalog order', () => {
    const result = normalizeToolGrants([
      'task_create',
      'not_a_tool',
      'task_find',
      'task_create',
      'delete_everything',
    ]);
    // Catalog order: task_find (read) precedes task_create (write).
    expect(result).toEqual(['task_find', 'task_create']);
  });

  it('returns [] for an empty or all-unknown list', () => {
    expect(normalizeToolGrants([])).toEqual([]);
    expect(normalizeToolGrants(['nope', 'still_nope'])).toEqual([]);
  });

  it('never contains a baseline tool (baseline is granted separately)', () => {
    const result = normalizeToolGrants([...KNOWLEDGE_READ_TOOLS, 'ask_human']);
    expect(result).toEqual([]);
  });
});

describe('the catalog', () => {
  it('classifies task_* creates and document_create as writes', () => {
    for (const name of [
      'task_create',
      'task_comment',
      'task_update_status',
      'task_upsert_by_external_ref',
      'document_create',
    ]) {
      expect(WRITE_EFFECT_TOOLS).toContain(name);
    }
  });

  it('classifies the find tools as reads (not writes)', () => {
    for (const name of ['task_find', 'task_get', 'document_find']) {
      expect(AGENT_GRANTABLE_TOOLS).toContain(name);
      expect(WRITE_EFFECT_TOOLS).not.toContain(name);
    }
  });
});

describe('grantedToolsGuidance', () => {
  it('is undefined when nothing beyond the baseline is granted', () => {
    expect(grantedToolsGuidance([])).toBeUndefined();
  });

  it('names the tools and warns when a write is present', () => {
    const guidance = grantedToolsGuidance(['task_find', 'task_create']);
    expect(guidance).toContain('task_find');
    expect(guidance).toContain('task_create');
    expect(guidance).toContain('change real organization data');
  });

  it('omits the write warning for a read-only grant', () => {
    const guidance = grantedToolsGuidance(['task_find', 'document_find']);
    expect(guidance).not.toContain('change real organization data');
  });
});

describe('secretsGuidance', () => {
  it('is empty for no secrets', () => {
    expect(secretsGuidance([])).toEqual([]);
  });

  it('names the env vars and forbids leaking them', () => {
    const [line] = secretsGuidance(['GLITCHTIP_TOKEN', 'LINEAR_API_KEY']);
    expect(line).toContain('GLITCHTIP_TOKEN');
    expect(line).toContain('LINEAR_API_KEY');
    expect(line).toContain('never print');
  });
});
