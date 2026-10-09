// @vitest-environment node

import { seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import type { Automation, NodeDef } from '../types';
import {
  canonicalNode,
  downstream,
  planFork,
  planReplay,
  replayModeAllowed,
} from './replay';

/** A step reading `reads` through its input mapping. */
function step(id: string, reads: string[] = [], extra?: Partial<NodeDef>) {
  const input: Record<string, string> = {};
  for (const ref of reads) input[ref] = `{{ nodes.${ref}.output }}`;
  return { id, type: 'echo', input, ...extra } satisfies NodeDef;
}

function doc(nodes: NodeDef[]): Automation {
  return { name: 'fork-test', nodes };
}

/** Checkpoints holding every listed step as done. */
function done(...ids: string[]) {
  return {
    nodes: Object.fromEntries(
      ids.map((id) => [id, { status: 'ok', output: null }]),
    ),
  };
}

describe('canonicalNode', () => {
  it('reads two definitions with the same fields alike, whatever their order', () => {
    expect(
      canonicalNode({
        id: 'a',
        type: 'echo',
        when: 'x',
        input: { b: 1, a: 2 },
      }),
    ).toBe(
      canonicalNode({
        input: { a: 2, b: 1 },
        when: 'x',
        type: 'echo',
        id: 'a',
      }),
    );
  });

  it('reads a field set to undefined as a field left out', () => {
    expect(canonicalNode({ id: 'a', type: 'echo', when: undefined })).toBe(
      canonicalNode({ id: 'a', type: 'echo' }),
    );
  });

  it('tells apart definitions that differ anywhere', () => {
    const base = step('a', ['b']);
    expect(canonicalNode(base)).not.toBe(
      canonicalNode({ ...base, onError: 'continue' }),
    );
    expect(canonicalNode(base)).not.toBe(
      canonicalNode({ ...base, input: { b: '{{ nodes.b.output.x }}' } }),
    );
  });
});

describe('downstream', () => {
  it('follows data references through every step that reads them', () => {
    const d = doc([
      step('a'),
      step('b', ['a']),
      step('c', ['b']),
      step('d'),
      step('e', ['d', 'c']),
    ]);
    expect(downstream(d, 'a')).toEqual(new Set(['b', 'c', 'e']));
    expect(downstream(d, 'd')).toEqual(new Set(['e']));
    expect(downstream(d, 'e')).toEqual(new Set());
  });

  it('follows conditions and else branches as well as data', () => {
    const d = doc([
      step('gate'),
      step('yes', [], { when: 'nodes.gate.output.ok' }),
      step('no', [], { elseOf: 'yes' }),
      step('after', ['no']),
    ]);
    expect(downstream(d, 'gate')).toEqual(new Set(['yes', 'no', 'after']));
    expect(downstream(d, 'yes')).toEqual(new Set(['no', 'after']));
  });

  it('answers nothing for a step the document does not have', () => {
    expect(downstream(doc([step('a'), step('b', ['a'])]), 'zz')).toEqual(
      new Set(),
    );
  });

  it('ignores a reference to a missing step and a step reading itself', () => {
    const d = doc([step('a', ['a', 'ghost']), step('b', ['a'])]);
    expect(downstream(d, 'a')).toEqual(new Set(['b']));
    expect(downstream(d, 'ghost')).toEqual(new Set());
  });
});

describe('planFork', () => {
  const chain = doc([
    step('fetch'),
    step('score', ['fetch']),
    step('notify', ['score']),
    step('audit', ['fetch']),
  ]);

  it('refuses a step to start from that the earlier version does not have', () => {
    expect(
      planFork({
        source: chain,
        target: doc([...chain.nodes, step('extra')]),
        from: 'extra',
        checkpoints: done('fetch'),
      }),
    ).toEqual({ ok: false, code: 'REPLAY_NODE_UNKNOWN', nodes: ['extra'] });
  });

  it('refuses a step to start from that the new version dropped', () => {
    expect(
      planFork({
        source: chain,
        target: doc(chain.nodes.filter((n) => n.id !== 'score')),
        from: 'score',
        checkpoints: done('fetch', 'score'),
      }),
    ).toEqual({ ok: false, code: 'REPLAY_NODE_UNKNOWN', nodes: ['score'] });
  });

  it('reuses what the run finished outside the step and what it feeds', () => {
    expect(
      planFork({
        source: chain,
        target: chain,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify', 'audit'),
      }),
    ).toEqual({
      ok: true,
      reuse: ['fetch', 'audit'],
      rerun: ['score', 'notify'],
    });
  });

  it('runs again a step the earlier run never finished', () => {
    // The run failed at `audit`, which `score` does not feed.
    expect(
      planFork({
        source: chain,
        target: chain,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify'),
      }),
    ).toEqual({
      ok: true,
      reuse: ['fetch'],
      rerun: ['score', 'notify', 'audit'],
    });
  });

  it('runs a step the new version added', () => {
    const target = doc([...chain.nodes, step('summary', ['notify'])]);
    expect(
      planFork({
        source: chain,
        target,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify', 'audit'),
      }),
    ).toEqual({
      ok: true,
      reuse: ['fetch', 'audit'],
      rerun: ['score', 'notify', 'summary'],
    });
  });

  it('lets the new version change the step to start from and what it feeds', () => {
    const target = doc([
      step('fetch'),
      step('score', ['fetch'], { onError: 'continue' }),
      step('notify', ['score'], { when: 'nodes.score.output.high' }),
      step('audit', ['fetch']),
    ]);
    expect(
      planFork({
        source: chain,
        target,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify', 'audit'),
      }),
    ).toMatchObject({ ok: true, reuse: ['fetch', 'audit'] });
  });

  it('refuses when the new version changed a reused step', () => {
    const target = doc([
      step('fetch', [], { input: { url: 'https://example.com/v2' } }),
      ...chain.nodes.slice(1),
    ]);
    expect(
      planFork({
        source: chain,
        target,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify', 'audit'),
      }),
    ).toEqual({ ok: false, code: 'REPLAY_GRAPH_CHANGED', nodes: ['fetch'] });
  });

  it('refuses when the new version dropped a reused step', () => {
    const target = doc([
      step('fetch'),
      step('score', ['fetch']),
      step('notify', ['score']),
    ]);
    expect(
      planFork({
        source: chain,
        target,
        from: 'score',
        checkpoints: done('fetch', 'score', 'notify', 'audit'),
      }),
    ).toEqual({ ok: false, code: 'REPLAY_GRAPH_CHANGED', nodes: ['audit'] });
  });

  it('refuses when a reused step would read a step that runs again', () => {
    // The new version has `audit` read `score`, which runs again: `audit`
    // changed, and `report`, unchanged, reads it, so it is refused too.
    const source = doc([
      step('fetch'),
      step('score', ['fetch']),
      step('audit', ['fetch']),
      step('report', ['audit']),
    ]);
    const target = doc([
      step('fetch'),
      step('score', ['fetch']),
      step('audit', ['fetch', 'score']),
      step('report', ['audit']),
    ]);
    expect(
      planFork({
        source,
        target,
        from: 'score',
        checkpoints: done('fetch', 'score', 'audit', 'report'),
      }),
    ).toEqual({
      ok: false,
      code: 'REPLAY_GRAPH_CHANGED',
      nodes: ['audit', 'report'],
    });
  });

  it('refuses a reused step whose input the run never finished', () => {
    // Progress that names `report` but not `audit`, which it reads, cannot
    // be the progress of one run of this version; it is not reused.
    const source = doc([
      step('fetch'),
      step('audit', ['fetch']),
      step('report', ['audit']),
      step('score'),
    ]);
    expect(
      planFork({
        source,
        target: source,
        from: 'score',
        checkpoints: done('fetch', 'report'),
      }),
    ).toEqual({ ok: false, code: 'REPLAY_GRAPH_CHANGED', nodes: ['report'] });
  });

  it('refuses a reused step the new version made depend on the step to start from', () => {
    // Unchanged `audit` reads `log`, and `log` now reads `score`: `log` is
    // changed and `audit` would read a step that runs again.
    const source = doc([step('score'), step('log'), step('audit', ['log'])]);
    const target = doc([
      step('score'),
      step('log', ['score']),
      step('audit', ['log']),
    ]);
    const plan = planFork({
      source,
      target,
      from: 'score',
      checkpoints: done('score', 'log', 'audit'),
    });
    expect(plan).toEqual({
      ok: false,
      code: 'REPLAY_GRAPH_CHANGED',
      nodes: ['log', 'audit'],
    });
  });

  it('decides an else branch again when its partner runs again', () => {
    const d = doc([
      step('triage'),
      step('urgent', ['triage'], { when: 'nodes.triage.output.urgent' }),
      step('routine', ['triage'], { elseOf: 'urgent' }),
    ]);
    expect(
      planFork({
        source: d,
        target: d,
        from: 'urgent',
        checkpoints: done('triage', 'urgent', 'routine'),
      }),
    ).toEqual({ ok: true, reuse: ['triage'], rerun: ['urgent', 'routine'] });
  });

  it('keeps the partner of an else branch it starts from', () => {
    const d = doc([
      step('triage'),
      step('urgent', ['triage'], { when: 'nodes.triage.output.urgent' }),
      step('routine', ['triage'], { elseOf: 'urgent' }),
    ]);
    const checkpoints = {
      nodes: {
        triage: { status: 'ok' },
        urgent: { status: 'skipped', reason: 'when' },
        routine: { status: 'ok' },
      },
    };
    expect(
      planFork({ source: d, target: d, from: 'routine', checkpoints }),
    ).toEqual({ ok: true, reuse: ['triage', 'urgent'], rerun: ['routine'] });
  });

  it('ignores progress for a step the earlier version does not have', () => {
    const target = doc([...chain.nodes, step('stray')]);
    expect(
      planFork({
        source: chain,
        target,
        from: 'score',
        checkpoints: done('fetch', 'audit', 'stray'),
      }),
    ).toEqual({
      ok: true,
      reuse: ['fetch', 'audit'],
      rerun: ['score', 'notify', 'stray'],
    });
  });

  it('lists steps in the execution order of the new version', () => {
    // Written out of order: `late` reads `early`, which comes after it.
    const d = doc([
      step('late', ['early']),
      step('from'),
      step('early'),
      step('tail', ['from']),
    ]);
    expect(
      planFork({
        source: d,
        target: d,
        from: 'from',
        checkpoints: done('late', 'early', 'from', 'tail'),
      }),
    ).toEqual({ ok: true, reuse: ['early', 'late'], rerun: ['from', 'tail'] });
  });

  it('holds its rules on random graphs', () => {
    // On any acyclic graph forked against itself, with every step done:
    // the plan is accepted, reuse and rerun split the steps, everything the
    // start feeds runs again, and a reused step reads only reused steps.
    const random = seeded(4711);
    for (let round = 0; round < 200; round++) {
      const count = 1 + Math.floor(random() * 9);
      const nodes: NodeDef[] = [];
      for (let index = 0; index < count; index++) {
        const reads = nodes
          .filter(() => random() < 0.35)
          .map((n) => n.id)
          .slice(0, 3);
        const extra: Partial<NodeDef> =
          index > 0 && random() < 0.15
            ? { elseOf: nodes[Math.floor(random() * nodes.length)]?.id }
            : {};
        nodes.push(step(`n${index}`, reads, extra));
      }
      const d = doc(nodes.toReversed());
      const from = `n${Math.floor(random() * count)}`;
      const plan = planFork({
        source: d,
        target: d,
        from,
        checkpoints: done(...nodes.map((n) => n.id)),
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) continue;
      expect([...plan.reuse, ...plan.rerun].toSorted()).toEqual(
        nodes.map((n) => n.id).toSorted(),
      );
      expect(new Set(plan.rerun)).toEqual(
        new Set([from, ...downstream(d, from)]),
      );
      const reused = new Set(plan.reuse);
      for (const id of plan.reuse) {
        const n = nodes.find((x) => x.id === id);
        const reads = [
          ...Object.keys(n?.input ?? {}),
          ...(n?.elseOf === undefined ? [] : [n.elseOf]),
        ];
        expect(reads.every((r) => reused.has(r))).toBe(true);
      }
      // Execution order: a step comes after every step it reads.
      const order = [...plan.reuse, ...plan.rerun];
      const at = (id: string) => plan.rerun.indexOf(id);
      for (const id of plan.rerun) {
        const n = nodes.find((x) => x.id === id);
        for (const r of Object.keys(n?.input ?? {})) {
          if (plan.rerun.includes(r)) expect(at(r)).toBeLessThan(at(id));
        }
      }
      expect(order).toHaveLength(count);
    }
  });
});

describe('replayModeAllowed', () => {
  it('lets a run again in any mode, and a fork never more real than its source [AUTO-R41]', () => {
    expect(replayModeAllowed('again', 'mock', 'live')).toBe(true);
    expect(replayModeAllowed('edited', 'mock', 'live')).toBe(true);
    expect(replayModeAllowed('from', 'live', 'mock')).toBe(true);
    expect(replayModeAllowed('from', 'live', 'live')).toBe(true);
    expect(replayModeAllowed('from', 'mock', 'live')).toBe(false);
  });
});

describe('planReplay', () => {
  const invoice = doc([
    step('fetch', [], { type: 'http.get' }),
    step('score', ['fetch'], { type: 'llm' }),
    step('send', ['score'], { type: 'smtp.send', forEach: '{{ [1, 2] }}' }),
    step('audit', ['fetch'], { type: 'transform' }),
  ]);
  const effectOf = (type: string) =>
    type === 'smtp.send' ? ('write' as const) : ('read' as const);
  const base = {
    mode: 'live' as const,
    canStartLive: true,
    source: {
      id: 'run-1',
      status: 'failed',
      mode: 'live' as const,
      version: 3,
      document: invoice,
      checkpoints: {
        nodes: {
          fetch: { status: 'ok' },
          score: { status: 'ok' },
          audit: { status: 'skipped', reason: 'when' },
        },
      },
      inputKnown: true,
      items: new Map([['send', 2]]),
    },
    target: {
      version: 3,
      resolved: 'same' as const,
      document: invoice,
      deployed: true,
    },
    effectOf,
  };

  it('runs everything again, counting the writes and calls it repeats', () => {
    const plan = planReplay({ ...base, kind: 'again' });
    expect(plan.refusal).toBeUndefined();
    expect(plan.reuse).toEqual([]);
    expect(plan.rerun).toEqual([
      { nodeId: 'fetch', type: 'http.get', effect: 'read', connector: 'http' },
      { nodeId: 'score', type: 'llm', effect: 'llm' },
      {
        nodeId: 'send',
        type: 'smtp.send',
        effect: 'write',
        connector: 'smtp',
        items: 2,
      },
      { nodeId: 'audit', type: 'transform', effect: 'none' },
    ]);
    expect(plan.writesAgain).toBe(2);
    expect(plan.spendAgain).toEqual({ llm: 1, agent: 0 });
    expect(plan.liveAllowed).toBe(true);
  });

  it('counts no write going out again for a mock replay', () => {
    expect(
      planReplay({ ...base, kind: 'again', mode: 'mock' }).writesAgain,
    ).toBe(0);
  });

  it('reuses what a fork does not feed, with why a step was skipped [AUTO-R41]', () => {
    const plan = planReplay({ ...base, kind: 'from', from: 'send' });
    expect(plan.refusal).toBeUndefined();
    expect(plan.reuse).toEqual([
      { nodeId: 'fetch', status: 'ok' },
      { nodeId: 'score', status: 'ok' },
      { nodeId: 'audit', status: 'skipped', reason: 'when' },
    ]);
    expect(plan.rerun.map((r) => r.nodeId)).toEqual(['send']);
  });

  it('refuses in order: no input, an unfinished run, unreadable progress, a fork more real than its source, a step it cannot start from', () => {
    const code = (over: Partial<Parameters<typeof planReplay>[0]>) =>
      planReplay({ ...base, kind: 'from', from: 'send', ...over }).refusal
        ?.code;
    expect(code({ source: { ...base.source, inputKnown: false } })).toBe(
      'REPLAY_INPUT_UNAVAILABLE',
    );
    expect(code({ source: { ...base.source, status: 'running' } })).toBe(
      'REPLAY_RUN_NOT_FINISHED',
    );
    expect(code({ source: { ...base.source, checkpoints: null } })).toBe(
      'REPLAY_PROGRESS_UNREADABLE',
    );
    expect(code({ source: { ...base.source, mode: 'mock' } })).toBe(
      'REPLAY_MODE_MISMATCH',
    );
    expect(code({ from: 'ghost' })).toBe('REPLAY_NODE_UNKNOWN');
    // An edited input needs none of the run's own.
    expect(
      planReplay({
        ...base,
        kind: 'edited',
        source: { ...base.source, inputKnown: false },
      }).refusal,
    ).toBeUndefined();
  });

  it('names the reused steps a changed version would compute differently', () => {
    const changed = doc([
      step('fetch', [], { type: 'http.get', input: { url: 'other' } }),
      ...invoice.nodes.slice(1),
    ]);
    expect(
      planReplay({
        ...base,
        kind: 'from',
        from: 'send',
        target: { ...base.target, version: 4, document: changed },
      }).refusal,
    ).toMatchObject({ code: 'REPLAY_GRAPH_CHANGED', nodes: ['fetch'] });
  });

  it('may not run live a version that is not deployed', () => {
    expect(
      planReplay({
        ...base,
        kind: 'again',
        target: { ...base.target, deployed: false },
      }).liveAllowed,
    ).toBe(false);
  });
});
