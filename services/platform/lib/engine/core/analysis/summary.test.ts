// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { loadConnectors } from '../../../connectors/registry';
import { memoryStore } from '../../selftest/memory-store';
import type { Automation, NodeDef } from '../types';
import { validate } from '../validate';
import { MAX_LISTED_PATHS, type AutomationAnalysis } from './summary';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../..',
);

beforeAll(() => {
  loadConnectors(path.join(REPO, 'configs/platform/system'));
});

async function analysisOf(doc: Automation): Promise<AutomationAnalysis> {
  const { analysis } = await validate(doc, { detail: ['analysis'] });
  if (analysis === undefined) throw new Error('no analysis');
  return analysis;
}

describe('the summary of a shipped pack: gmail/triage-inbox', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack; the corpus test validates it
  const pack = parse(
    readFileSync(
      path.join(
        REPO,
        'configs/platform/custom/automations/gmail/triage-inbox/workflow.yml',
      ),
      'utf8',
    ),
  ) as Automation;

  it('lists its two atoms, three ways to succeed and the nodes that halt', async () => {
    const a = await analysisOf(pack);
    expect(a.version).toBe(1);
    expect(a.paths.atoms.map((x) => x.id)).toEqual([
      'when:triage',
      'fail:propose',
    ]);
    expect(a.paths.count).toBe(3);
    expect(a.paths.truncated).toBe(false);
    expect(a.paths.success.map((p) => p.id)).toEqual([
      'when:triage=1|fail:propose=0',
      'when:triage=1|fail:propose=1',
      'when:triage=0',
    ]);
    expect(a.paths.halts.map((h) => h.nodeId)).toEqual([
      'inbox',
      'triage',
      'record',
      'due',
      'draft',
    ]);
    expect(a.paths.halts[0].reasons).toEqual([
      'external',
      'input-contract',
      'expression',
    ]);
    // On the quiet pass only the listing runs; the output reads it.
    expect(a.paths.success[2].outputReads).toEqual([
      { nodeId: 'inbox', ran: true },
      { nodeId: 'triage', ran: false },
      { nodeId: 'record', ran: false },
      { nodeId: 'due', ran: false },
      { nodeId: 'propose', ran: false },
    ]);
    expect(a.output).toEqual({
      reads: ['inbox', 'triage', 'record', 'due', 'propose'],
      maybeEmpty: false,
    });
  });

  it('says how each node runs, fails and connects', async () => {
    const a = await analysisOf(pack);
    expect(a.nodes.inbox).toMatchObject({
      index: 0,
      order: 0,
      reachable: true,
      alwaysRuns: true,
      maySkip: [],
      failureHandling: 'halts',
      readBy: { data: ['triage', 'due'], control: ['triage'], output: true },
    });
    expect(a.nodes.triage).toMatchObject({
      alwaysRuns: false,
      maySkip: [
        { reason: 'when', root: { atom: 'when:triage', nodeId: 'triage' } },
      ],
      reads: { data: ['inbox'], control: ['inbox'] },
    });
    expect(a.nodes.propose).toMatchObject({
      failureHandling: 'continues',
      failureReasons: ['external', 'input-contract', 'expression', 'iteration'],
      maySkip: [
        {
          reason: 'upstream',
          via: 'draft',
          root: { atom: 'when:triage', nodeId: 'triage' },
        },
        {
          reason: 'error',
          root: { atom: 'fail:propose', nodeId: 'propose' },
        },
      ],
      issues: { errors: 0, warnings: 0 },
    });
    expect(a.nodes.draft.iteration).toMatchObject({ kind: 'forEach' });
  });
});

describe('the summary', () => {
  it('counts each node issues and marks a static repeat', async () => {
    const a = await analysisOf({
      version: 1,
      name: 'summary-probe',
      nodes: [
        {
          id: 'poll',
          type: 'transform',
          code: 'return { done: true };',
          repeatUntil: '{{ input.done }}',
          maxRepeats: 4,
        },
      ],
      output: '{{ nodes.poll.output }}',
    });
    expect(a.nodes.poll.iteration).toEqual({
      kind: 'repeat',
      maxRepeats: 4,
      static: true,
    });
    expect(a.nodes.poll.issues).toEqual({ errors: 0, warnings: 1 });
  });

  it(`lists at most ${MAX_LISTED_PATHS} paths and counts them all`, async () => {
    const gates: NodeDef[] = Array.from({ length: 6 }, (_, i) => ({
      id: `g${i}`,
      type: 'transform',
      code: 'return 1;',
      when: `{{ input.g${i} }}`,
    }));
    const a = await analysisOf({
      version: 1,
      name: 'summary-paths',
      nodes: gates,
      output: '{{ nodes.g0.output ?? 0 }}',
    });
    expect(a.paths.count).toBe(64);
    expect(a.paths.success).toHaveLength(MAX_LISTED_PATHS);
  });

  it('is returned only when asked for, and not on a reference cycle', async () => {
    const doc: Automation = {
      version: 1,
      name: 'summary-detail',
      nodes: [{ id: 'a', type: 'transform', code: 'return { n: 1 };' }],
      output: '{{ nodes.a.output }}',
    };
    const lean = await validate(doc);
    expect(lean.analysis).toBeUndefined();
    expect(lean.types).toBeUndefined();
    const full = await validate(doc, { detail: ['analysis', 'types'] });
    expect(full.analysis?.nodes.a.alwaysRuns).toBe(true);
    expect(full.types?.nodes.a.ts).toBe('{ n: number }');

    const cyclic = await validate(
      {
        ...doc,
        nodes: [
          { id: 'a', type: 'transform', code: 'return nodes.b.output;' },
          { id: 'b', type: 'transform', code: 'return nodes.a.output;' },
        ],
      },
      { detail: ['analysis', 'types'] },
    );
    expect(cyclic.errors.map((e) => e.code)).toContain('REF_CYCLE');
    expect(cyclic.analysis).toBeUndefined();
    expect(cyclic.types).toBeDefined();
  });
});

describe('a called automation is the one a run would call', () => {
  it('checks the deployed version of an unpinned reference, the pinned one otherwise', async () => {
    const store = memoryStore();
    const child = (required: string): Automation => ({
      version: 1,
      name: 'child',
      inputs: {
        type: 'object',
        properties: { [required]: { type: 'string' } },
        required: [required],
      },
      nodes: [{ id: 'x', type: 'transform', code: 'return input;' }],
      output: '{{ nodes.x.output }}',
    });
    store.save('child', child('a'));
    store.save('child', child('b'));
    store.deploy('child', 1);
    const parent = (automation: string): Automation => ({
      version: 1,
      name: 'parent',
      nodes: [
        { id: 'sub', type: 'subautomation', automation, input: { a: 'x' } },
      ],
      output: '{{ nodes.sub.output }}',
    });
    const unpinned = await validate(parent('child'), { store });
    expect(
      unpinned.warnings.filter((w) => w.code === 'SUBAUTOMATION_INPUT_INVALID'),
    ).toEqual([]);
    const pinned = await validate(parent('child@2'), { store });
    expect(
      pinned.warnings.find((w) => w.code === 'SUBAUTOMATION_INPUT_INVALID')
        ?.params,
    ).toMatchObject({ automation: 'child', version: 2, missing: ['b'] });
  });
});
