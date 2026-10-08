// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import { loadConnectors } from '../../../connectors/registry';
import { memoryStore } from '../../selftest/memory-store';
import type { StoreAdapter } from '../slots';
import { newParseCtx } from '../syntax/sources';
import type { Automation, NodeDef } from '../types';
import {
  MAX_SUBAUTOMATION_DEPTH,
  parseAutomationRef,
  resolveChildren,
} from './children';
import { envFor, inferTypes, type AutomationTypes } from './infer';
import { lookup, toTs } from './shape';

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../..',
);

beforeAll(() => {
  loadConnectors(path.join(REPO, 'configs/platform/system'));
});

function doc(nodes: NodeDef[], extra: Partial<Automation> = {}): Automation {
  return { version: 1, name: 'demo', nodes, ...extra };
}

const tsOf = (types: AutomationTypes, id: string): string | undefined =>
  types.nodes[id]?.ts;

function transform(
  id: string,
  code: string,
  input?: Record<string, unknown>,
): NodeDef {
  return { id, type: 'transform', code, ...(input !== undefined && { input }) };
}

describe('inferTypes — node kinds', () => {
  it('reads the inputs schema and a missing output as null', () => {
    const types = inferTypes(
      doc([transform('a', 'return { ok: true };')], {
        inputs: {
          type: 'object',
          properties: { owner: { type: 'string' } },
          required: ['owner'],
        },
      }),
    );
    expect(toTs(types.inputs)).toBe('{ owner: string }');
    expect(toTs(types.output)).toBe('null');
  });

  it('types an llm by its outputSchema, or as text', () => {
    const types = inferTypes(
      doc([
        { id: 'chat', type: 'llm', model: 'm', prompt: 'hi' },
        {
          id: 'judge',
          type: 'llm',
          model: 'm',
          prompt: 'hi',
          outputSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      ]),
    );
    expect(tsOf(types, 'chat')).toBe('{ text: string }');
    expect(types.nodes.chat.origin).toBe('fixed');
    expect(tsOf(types, 'judge')).toBe('{ ok: boolean }');
    expect(types.nodes.judge.origin).toBe('declared');
  });

  it('types an agent by its fixed envelope', () => {
    const types = inferTypes(
      doc([{ id: 'dev', type: 'agent', model: 'm', prompt: 'go' }]),
    );
    expect(tsOf(types, 'dev')).toBe(
      '{ text: string, files: Array<{ name: string, storageId?: string, size?: number, contentType?: string }>, status: string }',
    );
  });

  it('types a connector action by its signature, and an unknown type as unknown', () => {
    const types = inferTypes(
      doc([
        { id: 'issues', type: 'github.list_issues', input: {} },
        { id: 'odd', type: 'nope.nothing', input: {} },
      ]),
    );
    expect(tsOf(types, 'issues')).toBe(
      '{ issues: Array<{ number: number, title: string, state: string, html_url: string }> }',
    );
    expect(types.nodes.issues.origin).toBe('signature');
    expect(types.nodes.odd).toMatchObject({ ts: 'unknown', origin: 'unknown' });
  });

  it('wraps a forEach node in a list and types its item', () => {
    const types = inferTypes(
      doc([
        { id: 'issues', type: 'github.list_issues', input: {} },
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ nodes.issues.output.issues }}',
          input: { title: '{{ item.title }}', at: '{{ index }}' },
          code: 'return { title: input.title, at: input.at };',
        },
      ]),
    );
    expect(toTs(types.nodes.each.item ?? {})).toBe(
      '{ number: number, title: string, state: string, html_url: string }',
    );
    expect(toTs(types.nodes.each.input ?? {})).toBe(
      '{ title: string, at: number }',
    );
    expect(tsOf(types, 'each')).toBe('Array<{ title: string, at: number }>');
  });

  it('types the document output from the nodes it reads', () => {
    const types = inferTypes(
      doc([{ id: 'issues', type: 'github.list_issues', input: {} }], {
        output: {
          count: '{{ nodes.issues.output.issues.length }}',
          first: '{{ nodes.issues.output.issues[0]?.title ?? null }}',
          note: 'found {{ nodes.issues.output.issues.length }}',
          fixed: 3,
        },
      }),
    );
    expect(toTs(types.output)).toBe(
      '{ count: number, first: string | null, note: string, fixed: number }',
    );
  });

  it('reads a node it cannot order as unknown', () => {
    const types = inferTypes(
      doc([
        transform('a', 'return { b: nodes.b.output.x };'),
        transform('b', 'return { x: nodes.a.output.b };'),
      ]),
    );
    expect(tsOf(types, 'a')).toBe('{ b: unknown }');
  });
});

describe('inferTypes — transform return literals', () => {
  const one = (code: string, input?: Record<string, unknown>) =>
    tsOf(inferTypes(doc([transform('t', code, input)])), 't');

  it('merges every return; a key in all of them is required', () => {
    expect(
      one(`
        if (input.x) return { kind: 'a', n: 1 };
        return { kind: 'b', extra: true };
      `),
    ).toBe('{ kind: string, n?: number, extra?: boolean }');
  });

  it('types values from the input mapping and top-level constants', () => {
    expect(
      one(
        `
          const total = input.items.length;
          const names = input.items.map((i) => i.name);
          return { total, names, owner: input.owner };
        `,
        { items: '{{ [{ name: "a" }] }}', owner: 'acme' },
      ),
    ).toBe('{ total: number, names: Array<string>, owner: string }');
  });

  it('sees no input key the mapping does not pass', () => {
    const types = inferTypes(doc([transform('t', 'return { v: input.v };')]));
    expect(
      lookup(
        types.nodes.t.input ?? envFor(types, { id: 't' }, 'code').input,
        'v',
      ),
    ).toEqual({
      kind: 'missing',
      closed: true,
      known: [],
    });
  });

  it('does not trust a constant the code changes in place', () => {
    expect(one('const out = {}; out.a = 1; return { out };')).toBe(
      '{ out: object }',
    );
    expect(one('const xs = []; xs.push(1); return { xs };')).toBe(
      '{ xs: Array<unknown> }',
    );
    expect(one('const o = {}; Object.assign(o, { a: 1 }); return { o };')).toBe(
      '{ o: object }',
    );
    expect(one("let n = 'a'; const s = n; return { s };")).toBe(
      '{ s: unknown }',
    );
    expect(one('const xs = [1]; return { xs };')).toBe('{ xs: Array<number> }');
  });

  it('lets a block-scoped local shadow a top-level constant', () => {
    expect(
      one(`
        const label = 'top';
        for (const label of [1]) { return { label }; }
        return { label };
      `),
    ).toBe('{ label: unknown }');
  });

  it('ignores returns of nothing, which fail the node', () => {
    expect(one('if (!input.ok) return null; return { ok: true };')).toBe(
      '{ ok: boolean }',
    );
  });

  it('reads a lone array literal, and nothing else', () => {
    expect(one('return [1, 2];')).toBe('Array<number>');
    expect(one('const r = { a: 1 }; return r;')).toBe('unknown');
    expect(one('return { ...input };')).toBe('unknown');
    expect(one('return [1]; return [2];')).toBe('unknown');
    expect(one('if (x) { return { a: 1 }; } return [1];')).toBe('unknown');
  });

  it('does not read returns inside nested functions', () => {
    expect(
      one('const f = () => { return { no: 1 }; }; return { yes: f() };'),
    ).toBe('{ yes: unknown }');
  });

  it('is unknown when the code does not parse', () => {
    expect(one('return {')).toBe('unknown');
  });
});

describe('inferTypes — the shipped triage packs', () => {
  const pack = (rel: string): Automation =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack; its corpus test validates it
    parse(
      readFileSync(
        path.join(REPO, 'configs/platform/custom/automations', rel),
        'utf8',
      ),
    ) as Automation;

  it('types github/triage-issues from its code', () => {
    const types = inferTypes(pack('github/triage-issues/workflow.yml'));
    expect(tsOf(types, 'open_issues')).toBe(
      '{ count: number, issues: Array<{ number: number, title: unknown, url: unknown, body: unknown, labels: unknown }> }',
    );
    expect(toTs(types.nodes.score.item ?? {})).toBe(
      '{ number: number, title: unknown, url: unknown, body: unknown, labels: unknown }',
    );
    expect(tsOf(types, 'score')).toBe(
      'Array<{ actionable: boolean, priority: "p0" | "p1" | "p2" | "p3", reason: string }>',
    );
    expect(tsOf(types, 'report')).toBe(
      '{ reviewed: number, actionable: number, issues: Array<unknown> }',
    );
    expect(toTs(types.output)).toBe(tsOf(types, 'report'));
  });

  it('types gmail/triage-inbox, whose code declares a local item', () => {
    const types = inferTypes(pack('gmail/triage-inbox/workflow.yml'));
    expect(tsOf(types, 'due')).toBe(
      '{ count: number, conversations: Array<unknown> }',
    );
    expect(toTs(types.output)).toBe(
      '{ read: number, summary: string | null, recorded: { recorded: number, prioritized: number, unknown: Array<string> } | null, needsReply: Array<unknown>, drafted: Array<{ approvalId: string, created: boolean }> }',
    );
  });

  it('shares one parse memo with its caller', () => {
    const parseCtx = newParseCtx();
    inferTypes(pack('github/triage-issues/workflow.yml'), { parse: parseCtx });
    expect(parseCtx.cache.size).toBeGreaterThan(0);
  });
});

describe('envFor', () => {
  // Typed once the connector catalog is registered.
  let types: AutomationTypes;
  beforeAll(() => {
    types = inferTypes(
      doc([
        { id: 'issues', type: 'github.list_issues', input: {} },
        {
          id: 'each',
          type: 'transform',
          forEach: '{{ nodes.issues.output.issues }}',
          input: { n: '{{ item.number }}' },
          code: 'return { n: input.n };',
          repeatUntil: '{{ output.n > 1 }}',
        },
      ]),
    );
  });
  const each = { id: 'each', forEach: '{{ nodes.issues.output.issues }}' };

  it('declares item and index where the runtime does', () => {
    expect(envFor(types, each, 'input').item).toBeDefined();
    expect(envFor(types, each, 'input').index).toBe(true);
    expect(envFor(types, each, 'when').item).toBeUndefined();
    expect(envFor(types, each, 'forEach').item).toBeUndefined();
  });

  it('hands code its own input mapping and repeatUntil one pass', () => {
    expect(toTs(envFor(types, each, 'code').input)).toBe('{ n: number }');
    expect(toTs(envFor(types, each, 'repeatUntil').output ?? {})).toBe(
      '{ n: number }',
    );
    expect(toTs(envFor(types, each, 'prompt').input)).toBe('unknown');
  });

  it('resolves node outputs and nothing else', () => {
    const env = envFor(types, undefined, 'output');
    expect(env.nodes('issues')).toBe(types.nodes.issues.output);
    expect(env.nodes('constructor')).toBeUndefined();
  });
});

describe('subautomations', () => {
  const child = (name: string, value: string): Automation =>
    doc([transform('make', `return { ${value}: 1 };`)], {
      name,
      output: `{{ nodes.make.output }}`,
    });
  const parent = (ref: string): Automation =>
    doc([{ id: 'sub', type: 'subautomation', automation: ref, input: {} }]);

  it('parses a reference like a run does', () => {
    expect(parseAutomationRef('weekly-report')).toEqual({
      name: 'weekly-report',
    });
    expect(parseAutomationRef('weekly-report@3')).toEqual({
      name: 'weekly-report',
      version: 3,
    });
    expect(parseAutomationRef('weekly-report@x')).toBeNull();
    expect(parseAutomationRef('a@1@2')).toBeNull();
  });

  it('types the deployed version of a bare reference, else the latest', async () => {
    const store = memoryStore();
    store.save('report', child('report', 'first'));
    store.save('report', child('report', 'second'));
    let children = await resolveChildren(parent('report'), store);
    expect(tsOf(inferTypes(parent('report'), { children }), 'sub')).toBe(
      '{ second: number }',
    );

    store.deploy('report', 1);
    children = await resolveChildren(parent('report'), store);
    expect(children.get('report')).toMatchObject({
      name: 'report',
      version: 1,
    });
    const types = inferTypes(parent('report'), { children });
    expect(tsOf(types, 'sub')).toBe('{ first: number }');
    expect(types.nodes.sub.origin).toBe('child');

    children = await resolveChildren(parent('report@2'), store);
    expect(tsOf(inferTypes(parent('report@2'), { children }), 'sub')).toBe(
      '{ second: number }',
    );
  });

  it('is unknown without the child, past the nesting limit and around a cycle', async () => {
    expect(tsOf(inferTypes(parent('report')), 'sub')).toBe('unknown');

    const store = memoryStore();
    // a → b → c → d: a run stops at the fourth level.
    const chain = ['b', 'c', 'd', 'e'];
    store.save('a', { ...parent('b'), name: 'a' });
    for (const [i, name] of chain.entries()) {
      const next = chain[i + 1];
      store.save(
        name,
        next === undefined
          ? child(name, 'leaf')
          : { ...parent(next), name, output: '{{ nodes.sub.output }}' },
      );
    }
    const top = { ...parent('b'), output: '{{ nodes.sub.output }}' };
    const children = await resolveChildren(top, store);
    expect([...children.keys()]).toEqual(['b', 'c', 'd']);
    expect(MAX_SUBAUTOMATION_DEPTH).toBe(3);
    expect(toTs(inferTypes(top, { children }).output)).toBe('unknown');

    const loop = memoryStore();
    loop.save('x', {
      ...parent('y'),
      name: 'x',
      output: '{{ nodes.sub.output }}',
    });
    loop.save('y', {
      ...parent('x'),
      name: 'y',
      output: '{{ nodes.sub.output }}',
    });
    const loopChildren = await resolveChildren(parent('x'), loop);
    expect(
      tsOf(inferTypes(parent('x'), { children: loopChildren }), 'sub'),
    ).toBe('unknown');
  });

  it('types a child that sits within the limit', async () => {
    const store = memoryStore();
    store.save('leaf', child('leaf', 'deep'));
    store.save('mid', {
      ...parent('leaf'),
      name: 'mid',
      output: '{{ nodes.sub.output }}',
    });
    const top = { ...parent('mid'), output: '{{ nodes.sub.output }}' };
    const children = await resolveChildren(top, store);
    expect(toTs(inferTypes(top, { children }).output)).toBe('{ deep: number }');
  });

  it('reads a store failure as an unknown child, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing: StoreAdapter = {
      list: async () => [],
      get: async () => {
        throw new Error('database down');
      },
      deployedVersion: async () => null,
    };
    const children = await resolveChildren(parent('report'), failing);
    expect(children.get('report')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
