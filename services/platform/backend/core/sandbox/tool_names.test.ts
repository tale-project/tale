import { describe, expect, it } from 'vitest';

import {
  grantedToolsGuidance,
  IMAGE_GENERATION_TOOL,
  imageGenerationGuidance,
  KNOWLEDGE_READ_TOOLS,
  normalizeToolGrants,
  PROJECT_AGENT_ONLY_TOOLS,
  readTurnOpRef,
  secretsGuidance,
  WRITE_EFFECT_TOOLS,
} from './tool_names';

describe('normalizeToolGrants', () => {
  it('grants task review only explicitly to project agents', () => {
    expect(normalizeToolGrants(['task_review'])).toEqual(['task_review']);
    expect(normalizeToolGrants(['task_review'], 'automation')).toEqual([]);
    expect(normalizeToolGrants([...KNOWLEDGE_READ_TOOLS])).not.toContain(
      'task_review',
    );
    expect(WRITE_EFFECT_TOOLS).toContain('task_review');
  });
  it('grants metadata only explicitly to project agents, never as a baseline or automation tool', () => {
    expect(normalizeToolGrants(['task_update_metadata'])).toEqual([
      'task_update_metadata',
    ]);
    expect(normalizeToolGrants(['task_update_metadata'], 'automation')).toEqual(
      [],
    );
    expect(normalizeToolGrants([...KNOWLEDGE_READ_TOOLS])).not.toContain(
      'task_update_metadata',
    );
    expect(WRITE_EFFECT_TOOLS).toContain('task_update_metadata');
  });
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

  it('keeps the delegation tool for a project agent and drops it for an automation', () => {
    const grants = ['task_find', 'task_start_agent', 'task_comment'];
    expect(normalizeToolGrants(grants)).toEqual([
      'task_find',
      'task_comment',
      'task_start_agent',
    ]);
    expect(normalizeToolGrants(grants, 'project_agent')).toEqual(
      normalizeToolGrants(grants),
    );
    expect(normalizeToolGrants(grants, 'automation')).toEqual([
      'task_find',
      'task_comment',
    ]);
    for (const name of PROJECT_AGENT_ONLY_TOOLS) {
      expect(normalizeToolGrants([name], 'automation')).toEqual([]);
    }
  });
});

describe('the catalog', () => {
  it('classifies task_* creates and document_create as writes', () => {
    for (const name of [
      'task_create',
      'task_comment',
      'task_update_status',
      'task_start_agent',
      'task_upsert_by_external_ref',
      'document_create',
    ]) {
      expect(WRITE_EFFECT_TOOLS).toContain(name);
    }
  });

  it('classifies the find tools as reads (not writes)', () => {
    for (const name of ['task_find', 'task_get', 'document_find']) {
      expect(normalizeToolGrants([name])).toEqual([name]);
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

describe('image generation', () => {
  it('is never user-grantable: the organization policy is the switch', () => {
    expect(normalizeToolGrants([IMAGE_GENERATION_TOOL])).toEqual([]);
  });

  it('names the tool and the delivery box the images land in', () => {
    const line = imageGenerationGuidance('/agent/output/task_1');
    expect(line).toContain('"workspace_tool"');
    expect(line).toContain(`tool: "${IMAGE_GENERATION_TOOL}"`);
    expect(line).toContain('/agent/output/task_1/');
    expect(line).toContain('billed to the organization');
    // The box delivers only its top level, and a turn's images are bounded.
    expect(line).toContain('no subfolders');
    expect(line).toContain("counts against this turn's spend allowance");
    expect(line).toContain('at most 16 images a turn');
  });

  it.each([
    [{ kind: 'task-agent', execId: 'exec_1' }, true],
    [{ kind: 'workflow-agent', execId: 'exec_2' }, true],
    [{ kind: 'chat', execId: 'exec_3' }, false],
    [{ kind: 'task-agent', execId: '' }, false],
    [{ kind: 'task-agent' }, false],
    ['task-agent', false],
    [null, false],
    [undefined, false],
  ])('reads a token turnOp %j', (value, valid) => {
    expect(readTurnOpRef(value) !== undefined).toBe(valid);
    if (valid) expect(readTurnOpRef(value)).toEqual(value);
  });
});
