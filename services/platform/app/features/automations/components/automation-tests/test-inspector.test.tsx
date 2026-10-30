import { describe, expect, it, vi } from 'vitest';

import type { TransientRecord } from '@/lib/engine/core/record/transient';
import { render, screen, waitFor } from '@/tests/utils/render';

import type {
  AutomationTests,
  TestRow,
} from '../../hooks/use-automation-tests';
import {
  TestFields,
  type TestFieldsProps,
  type TestInspectorTab,
  type TestSetupMode,
} from './test-inspector';
import { testYaml } from './test-yaml-editor';

const TEST = {
  name: 'triples seven',
  input: { n: 7 },
  expect: { output: { total: 21, currency: 'CHF' } },
  mocks: { fetch_rates: { chf: 1 } },
};

const FAILED: TestRow = {
  index: 0,
  id: 'test-0',
  name: 'triples seven',
  status: 'failed',
  outcome: {
    kind: 'run',
    stale: false,
    at: 1,
    result: {
      name: 'triples seven',
      index: 0,
      pass: false,
      ms: 4,
      message: 'output differs at /total',
      unusedMocks: ['fetch_rates'],
      failures: [
        {
          kind: 'output',
          mode: 'exact',
          total: 1,
          mismatches: [
            {
              pointer: '/total',
              path: ['total'],
              kind: 'changed',
              before: 21,
              after: 14,
            },
          ],
        },
      ],
      run: {
        status: 'success',
        output: { total: 14, currency: 'CHF' },
      },
    },
  },
  reason: 'The output differs from what the test expects in 1 place.',
  meta: '4 ms',
  badges: [],
};

type Replace = (index: number, test: unknown) => void;

function controller(
  row: TestRow,
  replace: Replace = vi.fn<Replace>(),
): AutomationTests {
  return {
    tests: [TEST],
    rows: [row],
    counts: { passed: 0, failed: 1, error: 0, notRun: 0, stale: 0, total: 1 },
    status: 'idle',
    running: new Set(),
    failure: null,
    reportFailure: null,
    source: 'Run on your draft',
    announceKey: 0,
    runDisabledReason: undefined,
    runAll: vi.fn(),
    runOne: vi.fn(),
    retry: vi.fn(),
    add: vi.fn(),
    duplicate: vi.fn(),
    remove: vi.fn(),
    replace,
  };
}

/** The automation the tests run: rates fetched, then a total. */
const DOC = {
  name: 'invoice-total',
  nodes: [
    { id: 'fetch_rates', type: 'http.get' },
    { id: 'total', type: 'transform', code: 'return {};' },
  ],
};

function renderFields(
  row: TestRow,
  options: {
    tab?: TestInspectorTab;
    replace?: Replace;
    setupMode?: TestSetupMode;
    onShowRun?: () => void;
    test?: unknown;
    doc?: TestFieldsProps['doc'];
    readOnly?: boolean;
    lastRunOutputOf?: (nodeId: string) => unknown;
  } = {},
) {
  const onTabChange = vi.fn();
  const onSetupModeChange = vi.fn();
  const onSelectNode = vi.fn();
  const tests = {
    ...controller(row, options.replace),
    tests: [options.test ?? TEST],
  };
  const view = render(
    <TestFields
      headingId="test-heading"
      tests={tests}
      index={0}
      settledTest={options.test ?? TEST}
      issues={[]}
      diagnosticsStatus="ready"
      readOnly={options.readOnly ?? false}
      tab={options.tab ?? 'result'}
      onTabChange={onTabChange}
      setupMode={options.setupMode ?? 'form'}
      onSetupModeChange={onSetupModeChange}
      doc={options.doc ?? DOC}
      {...(options.lastRunOutputOf !== undefined && {
        lastRunOutputOf: options.lastRunOutputOf,
      })}
      text={{}}
      onSelectNode={onSelectNode}
      {...(options.onShowRun !== undefined && { onShowRun: options.onShowRun })}
    />,
  );
  return { ...view, tests, onTabChange, onSelectNode, onSetupModeChange };
}

/** A run's record as a test's result keeps it: only that it is kept
 * matters to the inspector. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a record built by hand, with none of the steps the inspector never reads
const RECORD = {
  view: { nodes: [] },
  details: [],
} as unknown as TransientRecord;

describe('the test inspector', () => {
  it('lays the test’s run over the canvas when its result keeps the steps', async () => {
    const onShowRun = vi.fn();
    const { unmount } = renderFields(FAILED, { onShowRun });
    // This result keeps no steps: there is nothing to lay over the canvas.
    expect(
      screen.queryByRole('button', { name: 'Show on the canvas' }),
    ).not.toBeInTheDocument();
    unmount();
    const outcome = FAILED.outcome;
    if (outcome.kind !== 'run') throw new Error('a run outcome');
    const kept: TestRow = {
      ...FAILED,
      outcome: {
        ...outcome,
        result: {
          ...outcome.result,
          run: { status: 'success', record: RECORD },
        },
      },
    };
    const { user } = renderFields(kept, { onShowRun });
    await user.click(
      screen.getByRole('button', { name: 'Show on the canvas' }),
    );
    expect(onShowRun).toHaveBeenCalledTimes(1);
  });

  it('names the test, its place and status, and runs it alone', async () => {
    const { user, tests } = renderFields(FAILED);
    expect(screen.getByText('triples seven')).toBeVisible();
    expect(screen.getByText('Test 1 of 1')).toBeVisible();
    expect(screen.getByText('Failed')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run triples seven' }));
    expect(tests.runOne).toHaveBeenCalledWith(0);
  });

  it('shows what the test expected beside what the run returned', () => {
    renderFields(FAILED);
    expect(
      screen.getByText(
        'The output differs from what the test expects in 1 place.',
      ),
    ).toBeVisible();
    // The differences, one sentence each, under the diff's own name.
    expect(
      screen.getByRole('list', { name: 'Expected and actual output' }),
    ).toHaveTextContent('total');
    // The stand-in it never used, by the node's name.
    expect(
      screen.getByText('Not used: Fetch rates. The run skipped them.'),
    ).toBeVisible();
    expect(screen.getByText('Simulated: Fetch rates')).toBeVisible();
  });

  it('takes the test as YAML, as written, once it parses', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      setupMode: 'yaml',
    });
    const yaml = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Test as YAML',
    });
    expect(yaml.value).toBe(testYaml(TEST));
    // A line that does not parse changes nothing yet.
    await user.click(yaml);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('name: [unclosed');
    expect(replace).not.toHaveBeenCalled();
    await user.keyboard('{Control>}a{/Control}');
    await user.paste('name: renamed\ninput:\n  n: 8\nnote: kept\n');
    await waitFor(() =>
      expect(replace).toHaveBeenLastCalledWith(0, {
        name: 'renamed',
        input: { n: 8 },
        note: 'kept',
      }),
    );
  });

  it('edits the test as a form, keeping every key the form does not show', async () => {
    const replace = vi.fn<Replace>();
    const { user, onSetupModeChange } = renderFields(FAILED, {
      tab: 'setup',
      replace,
    });
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.type(name, '!');
    expect(replace).toHaveBeenLastCalledWith(0, {
      ...TEST,
      name: 'triples seven!',
    });
    // Each simulated output is its own field, by the node's name.
    expect(screen.getByText('Fetch rates')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Remove Fetch rates' }),
    );
    const { mocks: _gone, ...withoutMocks } = TEST;
    expect(replace).toHaveBeenLastCalledWith(0, withoutMocks);
    // The output's comparison switches without losing the value.
    await user.click(screen.getByRole('radio', { name: 'Includes' }));
    expect(replace).toHaveBeenLastCalledWith(0, {
      ...TEST,
      expect: { outputIncludes: { total: 21, currency: 'CHF' } },
    });
    await user.click(screen.getByRole('switch', { name: 'Edit as YAML' }));
    expect(onSetupModeChange).toHaveBeenCalledWith('yaml');
  });

  it('turns on a run that must fail, dropping the output it cannot have', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, { tab: 'setup', replace });
    await user.click(screen.getByRole('switch', { name: /The run must fail/ }));
    expect(replace).toHaveBeenLastCalledWith(0, {
      ...TEST,
      expect: { failure: {} },
    });
  });

  it.each([false, true])(
    'starts a new mock empty without copying the displayed run (forEach=%s)',
    async (forEach) => {
      const replace = vi.fn<Replace>();
      const source = {
        customer: 'Synthetic Ada',
        email: 'ada@example.invalid',
      };
      const lastRunOutputOf = vi.fn(() => source);
      const { mocks: _mocks, ...withoutMocks } = TEST;
      const { user } = renderFields(FAILED, {
        tab: 'setup',
        replace,
        test: withoutMocks,
        doc: {
          ...DOC,
          nodes: DOC.nodes.map((node) =>
            node.id === 'fetch_rates' && forEach
              ? Object.assign({}, node, { forEach: '{{ input.items }}' })
              : node,
          ),
        },
        lastRunOutputOf,
      });
      await user.click(
        screen.getByRole('combobox', { name: "Simulate a node's output" }),
      );
      await user.click(screen.getByRole('option', { name: 'Fetch rates' }));
      expect(replace).toHaveBeenLastCalledWith(0, {
        ...withoutMocks,
        mocks: { fetch_rates: forEach ? [] : {} },
      });
      expect(lastRunOutputOf).not.toHaveBeenCalled();
      expect(TEST.mocks).toEqual({ fetch_rates: { chf: 1 } });
    },
  );

  it('keeps a saved mock until its author explicitly copies the last run output', async () => {
    const replace = vi.fn<Replace>();
    const source = { customer: 'Synthetic Ada', email: 'ada@example.invalid' };
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      lastRunOutputOf: () => source,
    });
    expect(replace).not.toHaveBeenCalled();
    expect(TEST.mocks).toEqual({ fetch_rates: { chf: 1 } });
    expect(
      screen.getByText(
        /The copies can remain after the source run is deleted or removed through retention or erasure/,
      ),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: "Use the last run's output" }),
    );
    expect(replace).toHaveBeenLastCalledWith(0, {
      ...TEST,
      mocks: { fetch_rates: source },
    });
    expect(TEST.mocks).toEqual({ fetch_rates: { chf: 1 } });
  });

  it('keeps read-only saved mocks without a copy or add action', () => {
    const replace = vi.fn<Replace>();
    renderFields(FAILED, {
      tab: 'setup',
      replace,
      readOnly: true,
      lastRunOutputOf: () => ({ customer: 'Synthetic Ada' }),
    });
    expect(
      screen.queryByRole('button', { name: "Use the last run's output" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('combobox', { name: "Simulate a node's output" }),
    ).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(TEST.mocks).toEqual({ fetch_rates: { chf: 1 } });
  });

  it('keeps the result tab closed until the test has a result', () => {
    const { onTabChange } = renderFields(
      { ...FAILED, status: 'not-run', outcome: { kind: 'none' } },
      { tab: 'result' },
    );
    expect(screen.getByRole('tab', { name: 'Result' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Setup' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('says a result no longer holds once the automation or test changed', () => {
    renderFields({
      ...FAILED,
      status: 'stale',
      outcome: { ...FAILED.outcome, stale: true } as TestRow['outcome'],
    });
    expect(
      screen.getByText(
        'The automation or this test changed since this result. Run the test again to see where it stands.',
      ),
    ).toBeVisible();
  });
});
