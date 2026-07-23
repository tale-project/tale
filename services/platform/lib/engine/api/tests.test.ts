import { beforeAll, describe, expect, it } from 'vitest';

import { registerNodeType, setCodeRunner } from '../core/slots';
import type { Workflow } from '../core/types';
import { nodeVmRunner } from '../runners/node-vm';
import { runWorkflowTests, stableStringify } from './tests';

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'ping.send',
    kind: 'integration',
    outputKind: 'structured',
    description: 'test connector: sends a ping',
    allowedFields: ['input'],
    requiredFields: ['input'],
    integration: {
      name: 'ping.send',
      description: 'send a ping',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      mock: () => ({ ok: true }),
    },
  });
});

const DOUBLER: Workflow = {
  version: 1,
  name: 'doubler',
  nodes: [
    {
      id: 'double',
      type: 'transform',
      input: { n: '{{ input.n }}' },
      code: 'return input.n * 2;',
    },
    { id: 'notify', type: 'ping.send', input: { note: 'done' } },
  ],
  output: '{{ nodes.double.output }}',
  tests: [
    { name: 'doubles 3', input: { n: 3 }, expect: { output: 6 } },
    {
      name: 'pings',
      input: { n: 1 },
      expect: {
        effects: [{ integration: 'ping.send', input: { note: 'done' } }],
      },
    },
  ],
};

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ a: 1, b: [2, { d: 3, c: 4 }] })).toBe(
      stableStringify({ b: [2, { c: 4, d: 3 }], a: 1 }),
    );
  });
});

describe('runWorkflowTests', () => {
  it('reports pass counts for green tests', async () => {
    const report = await runWorkflowTests(DOUBLER);
    expect(report).toMatchObject({ passed: 2, failed: 0 });
  });

  it('reports output mismatches with both sides', async () => {
    const wf: Workflow = {
      ...DOUBLER,
      tests: [{ name: 'wrong', input: { n: 3 }, expect: { output: 7 } }],
    };
    const report = await runWorkflowTests(wf);
    if ('results' in report) {
      expect(report.failed).toBe(1);
      expect(report.results[0]?.message).toContain('expected 7 but got 6');
    } else {
      expect.unreachable('expected a report');
    }
  });

  it('reports missing effects naming the actual ones', async () => {
    const wf: Workflow = {
      ...DOUBLER,
      tests: [
        {
          name: 'no such effect',
          input: { n: 1 },
          expect: { effects: [{ integration: 'mail.send' }] },
        },
      ],
    };
    const report = await runWorkflowTests(wf);
    if ('results' in report) {
      expect(report.results[0]?.message).toContain('mail.send');
      expect(report.results[0]?.message).toContain('ping.send');
    } else {
      expect.unreachable('expected a report');
    }
  });

  it('guides when the workflow ships no tests', async () => {
    const report = await runWorkflowTests({ ...DOUBLER, tests: [] });
    expect(report).toMatchObject({
      error: 'the workflow has no tests',
      hint: expect.stringContaining('tests:'),
    });
  });

  it('surfaces run failures as test failures', async () => {
    const wf: Workflow = {
      ...DOUBLER,
      tests: [{ name: 'boom', input: {}, expect: { output: 1 } }],
    };
    // input.n missing → transform multiplies undefined → run error.
    const report = await runWorkflowTests(wf);
    if ('results' in report) {
      expect(report.results[0]?.pass).toBe(false);
      expect(report.results[0]?.message).toContain('run error');
    } else {
      expect.unreachable('expected a report');
    }
  });
});
