// @vitest-environment node

/**
 * A test for a path takes that path: the failures the path needs are
 * simulated, a condition that reads one node's output starts a stand-in for
 * it, the description says what each condition needs, and the nodes the
 * path decides are expected to do what it says. Run by the engine, each
 * test lands on its own path — the one whose condition must be false once
 * its stand-in is edited as its description asks.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { runAutomationTests } from '../../engine/api/tests';
import { analyzeFlow } from '../../engine/core/analysis/flow';
import { registerNodeType, setCodeRunner } from '../../engine/core/slots';
import type { Automation, AutomationTest } from '../../engine/core/types';
import { validate } from '../../engine/core/validate';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import { PATH_FAILURE_MESSAGE, type PathNeed, testForPath } from './path-test';

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
  registerNodeType({
    type: 'inbox.list',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: lists the conversations waiting',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'inbox.list',
      description: 'list the conversations waiting',
      inputSchema: { type: 'object' },
      outputSignature: '{ conversations: { id: string }[] }',
      hasEffect: false,
      mock: () => ({ conversations: [{ id: 'c1' }, { id: 'c2' }] }),
    },
  });
  registerNodeType({
    type: 'inbox.reply',
    kind: 'connector',
    outputKind: 'structured',
    description: 'test connector: drafts a reply',
    allowedFields: ['input'],
    requiredFields: ['input'],
    connector: {
      name: 'inbox.reply',
      description: 'draft a reply',
      inputSchema: { type: 'object' },
      outputSignature: '{ ok: boolean }',
      hasEffect: true,
      mock: () => ({ ok: true }),
    },
  });
});

const TRIAGE: Automation = {
  version: 1,
  name: 'triage-inbox',
  nodes: [
    { id: 'inbox', type: 'inbox.list', input: { limit: 25 } },
    {
      id: 'triage',
      type: 'llm',
      model: 'openai/gpt-4o',
      when: '{{ nodes.inbox.output.conversations.length > 0 }}',
      prompt: 'Sort {{ nodes.inbox.output.conversations }}',
    },
    {
      id: 'propose',
      type: 'inbox.reply',
      onError: 'continue',
      input: { text: '{{ nodes.triage.output.text }}' },
    },
    {
      id: 'report',
      type: 'transform',
      input: { read: '{{ nodes.inbox.output.conversations.length }}' },
      code: 'return { read: input.read };',
    },
  ],
  output: '{{ nodes.report.output }}',
};

/** What a condition needs, as the editor would word it. */
function describeNeed(need: PathNeed): string {
  return `Make the condition of ${need.node} ${need.value ? 'hold' : 'false'}`;
}

/** The inferred shape of every node's output, as the check answers them. */
async function outputShapes(
  automation: Automation,
): Promise<Record<string, unknown>> {
  const { types } = await validate(automation, { detail: ['types'] });
  return Object.fromEntries(
    Object.entries(types?.nodes ?? {}).map(([id, info]) => [id, info.output]),
  );
}

/** The path a test's run took, run by the engine. */
async function pathTaken(
  automation: Automation,
  test: AutomationTest,
): Promise<{ pass: boolean; path?: string }> {
  const report = await runAutomationTests({ ...automation, tests: [test] });
  if (!('results' in report)) throw new Error(report.error);
  const [result] = report.results;
  if (result === undefined) throw new Error('no result');
  return {
    pass: result.pass,
    ...(result.path !== undefined && { path: result.path.id }),
  };
}

describe('testForPath', () => {
  it('lists the paths it builds a test for', () => {
    expect(analyzeFlow(TRIAGE.nodes)?.paths.map((path) => path.id)).toEqual([
      'when:triage=1|fail:propose=0',
      'when:triage=1|fail:propose=1',
      'when:triage=0',
    ]);
  });

  it('simulates the failure a path needs and expects the nodes it decides', async () => {
    const built = testForPath({
      document: TRIAGE,
      pathId: 'when:triage=1|fail:propose=1',
      name: 'a draft that fails',
      outputShapes: await outputShapes(TRIAGE),
      describe: describeNeed,
    });
    expect(built?.needs).toEqual([
      { atom: 'when:triage', node: 'triage', kind: 'when', value: true },
      { atom: 'fail:propose', node: 'propose', kind: 'failure', value: true },
    ]);
    expect(built?.test).toEqual({
      name: 'a draft that fails',
      description: 'Make the condition of triage hold',
      input: {},
      mocks: { inbox: { conversations: [{ id: 'mock' }] } },
      failures: { propose: PATH_FAILURE_MESSAGE },
      expect: { nodes: { triage: 'ran', propose: 'failed' } },
    });
  });

  it('builds tests the engine runs down their own paths', async () => {
    const shapes = await outputShapes(TRIAGE);
    for (const pathId of [
      'when:triage=1|fail:propose=0',
      'when:triage=1|fail:propose=1',
    ]) {
      const built = testForPath({
        document: TRIAGE,
        pathId,
        name: pathId,
        outputShapes: shapes,
      });
      if (built === null) throw new Error(`no test for ${pathId}`);
      expect(await pathTaken(TRIAGE, built.test)).toEqual({
        pass: true,
        path: pathId,
      });
    }
  });

  it('asks for the false condition in words, and takes the path once its stand-in says so', async () => {
    const built = testForPath({
      document: TRIAGE,
      pathId: 'when:triage=0',
      name: 'nothing waiting',
      outputShapes: await outputShapes(TRIAGE),
      describe: describeNeed,
    });
    if (built === null) throw new Error('no test');
    expect(built.test.description).toBe('Make the condition of triage false');
    expect(built.test.expect).toEqual({
      nodes: { triage: 'skipped', propose: 'skipped' },
    });
    // As built, the stand-in still holds a conversation: the test fails on
    // the expected skips until the author empties the list it asks for.
    expect((await pathTaken(TRIAGE, built.test)).pass).toBe(false);
    const edited = {
      ...built.test,
      mocks: { inbox: { conversations: [] } },
    };
    expect(await pathTaken(TRIAGE, edited)).toEqual({
      pass: true,
      path: 'when:triage=0',
    });
  });

  it('starts no stand-in for a condition that reads anything but one calling node', () => {
    const variants: Array<[string, string]> = [
      ['the run input', '{{ input.urgent }}'],
      ['a transform', '{{ nodes.report.output.read > 0 }}'],
      [
        'two nodes',
        '{{ nodes.inbox.output.conversations.length > nodes.report.output.read }}',
      ],
    ];
    for (const [_reads, when] of variants) {
      const document: Automation = {
        ...TRIAGE,
        nodes: TRIAGE.nodes.map((node) =>
          node.id === 'triage' ? { ...node, when } : node,
        ),
      };
      const built = testForPath({
        document,
        pathId: 'when:triage=0',
        name: 'n',
        outputShapes: { inbox: { type: 'object' }, report: { type: 'object' } },
      });
      expect(built?.test.mocks).toBeUndefined();
    }
  });

  it('starts no stand-in without the shape of the output it reads', () => {
    const built = testForPath({
      document: TRIAGE,
      pathId: 'when:triage=0',
      name: 'n',
    });
    expect(built?.test).toEqual({
      name: 'n',
      input: {},
      expect: { nodes: { triage: 'skipped', propose: 'skipped' } },
    });
  });

  it('words a simulated failure as asked, and starts from the input given', () => {
    const built = testForPath({
      document: TRIAGE,
      pathId: 'when:triage=1|fail:propose=1',
      name: 'n',
      input: { limit: 1 },
      failureMessage: 'the conversation was closed meanwhile',
    });
    expect(built?.test.input).toEqual({ limit: 1 });
    expect(built?.test.failures).toEqual({
      propose: 'the conversation was closed meanwhile',
    });
  });

  it('expects nothing of a document every run goes through alike', () => {
    const straight: Automation = {
      version: 1,
      name: 'straight',
      nodes: [{ id: 'a', type: 'transform', code: 'return 1;' }],
      output: '{{ nodes.a.output }}',
    };
    expect(
      testForPath({ document: straight, pathId: '', name: 'only way' }),
    ).toEqual({ test: { name: 'only way', input: {} }, needs: [] });
  });

  it('has no test for a path the document does not have', () => {
    expect(
      testForPath({ document: TRIAGE, pathId: 'when:propose=1', name: 'n' }),
    ).toBeNull();
    const cycle: Automation = {
      version: 1,
      name: 'cycle',
      nodes: [
        {
          id: 'a',
          type: 'transform',
          input: { b: '{{ nodes.b.output }}' },
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          input: { a: '{{ nodes.a.output }}' },
          code: 'return 1;',
        },
      ],
    };
    expect(testForPath({ document: cycle, pathId: '', name: 'n' })).toBeNull();
  });
});
