// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SHAPE_DEPTH } from '@/lib/shared/schemas/automation-issues';

import { validateAutomationDraft } from './automation-validation';

/**
 * The draft check at its boundary: what the editor asks for beside the
 * issues, and how each part of the answer is read on its own — a malformed
 * analysis or shape tree is dropped with a warning, never the issues.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const ISSUE = {
  level: 'error',
  code: 'REF_UNKNOWN_NODE',
  message: 'nodes.nope does not exist',
  at: { pointer: '/nodes/0/prompt' },
};

const ANALYSIS = {
  version: 1,
  nodes: { a: { failureReasons: ['code'], reachable: true } },
  paths: {
    atoms: [],
    success: [],
    count: 1,
    truncated: false,
    halts: [{ nodeId: 'a', reasons: ['code'] }],
  },
  output: { reads: ['a'], maybeEmpty: false },
};

const TYPES = {
  inputs: { type: 'object', properties: {} },
  nodes: {
    a: {
      output: {
        type: 'object',
        properties: { count: { type: 'number' } },
        required: ['count'],
        'x-origin': 'inferred',
      },
      ts: '{ count: number }',
      origin: 'inferred',
    },
  },
  output: { type: 'object', properties: { count: { type: 'number' } } },
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

function answerWith(body: unknown) {
  fetchSpy.mockImplementation(async () => jsonResponse(body));
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
  fetchSpy = vi.spyOn(window, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('validateAutomationDraft', () => {
  it('asks for the detail it names and reads the analysis and the shapes', async () => {
    answerWith({
      valid: false,
      errors: [ISSUE],
      warnings: [],
      analysis: ANALYSIS,
      types: TYPES,
    });
    const check = await validateAutomationDraft(
      'org-1',
      'support/triage',
      { name: 'x', nodes: [] },
      { detail: ['analysis', 'types'] },
    );
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      detail: ['analysis', 'types'],
    });
    expect(check.errors).toEqual([expect.objectContaining(ISSUE)]);
    expect(check.analysis).toEqual({
      nodes: { a: { failureReasons: ['code'] } },
      paths: {
        count: 1,
        truncated: false,
        halts: [{ nodeId: 'a', reasons: ['code'] }],
      },
      output: { reads: ['a'], maybeEmpty: false },
    });
    expect(check.types?.nodes.a?.output).toEqual(TYPES.nodes.a.output);
  });

  it('drops a malformed shape tree with a warning and keeps the issues', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answerWith({
      valid: false,
      errors: [ISSUE],
      warnings: [],
      types: { ...TYPES, nodes: { a: { output: { properties: 'nope' } } } },
    });
    const check = await validateAutomationDraft('org-1', 'x', {});
    expect(check.types).toBeUndefined();
    expect(check.errors).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('types'),
      expect.anything(),
    );
  });

  it('reads a shape deeper than the cap as anything, instead of recursing on', async () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < MAX_SHAPE_DEPTH + 4; i++) {
      deep = { type: 'array', items: deep };
    }
    answerWith({
      valid: true,
      errors: [],
      warnings: [],
      types: { ...TYPES, output: deep },
    });
    const check = await validateAutomationDraft('org-1', 'x', {});
    let at: unknown = check.types?.output;
    let depth = 0;
    while (typeof at === 'object' && at !== null && 'items' in at) {
      at = (at as { items: unknown }).items;
      depth++;
    }
    expect(depth).toBe(MAX_SHAPE_DEPTH);
    expect(at).toEqual({});
  });

  it('answers without detail when none was asked for', async () => {
    answerWith({ valid: true, errors: [], warnings: [] });
    const check = await validateAutomationDraft('org-1', 'x', {});
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ detail: [] });
    expect(check).toEqual({ valid: true, errors: [], warnings: [] });
  });
});
