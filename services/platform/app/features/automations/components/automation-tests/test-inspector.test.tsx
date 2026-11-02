import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TransientRecord } from '@/lib/engine/core/record/transient';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type {
  AutomationTests,
  TestRow,
} from '../../hooks/use-automation-tests';
import type { ConnectorScenarioSummary } from '../connector-scenario';
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
    scenariosOf?: TestFieldsProps['scenariosOf'];
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
      scenariosOf={options.scenariosOf ?? (() => [])}
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

/** A run's record with a step per node, in the status given: all a result
 * reads of it to say why a stand-in went unused. */
function recordOf(steps: Record<string, string>): TransientRecord {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a record built by hand, with only its steps' nodes and statuses
  return {
    view: {
      nodes: Object.entries(steps).map(([nodeId, status]) => ({
        path: nodeId,
        nodeId,
        type: 'transform',
        status,
        meta: {},
        activeMs: 0,
      })),
    },
    details: [],
  } as unknown as TransientRecord;
}

/** The failed row with these stand-ins unused, and its run's record — or,
 * without one, a run too large to keep its steps. */
function withUnused(unusedMocks: string[], record?: TransientRecord): TestRow {
  const outcome = FAILED.outcome;
  if (outcome.kind !== 'run') throw new Error('a run outcome');
  const { run: _run, ...result } = outcome.result;
  return {
    ...FAILED,
    outcome: {
      ...outcome,
      result: {
        ...result,
        unusedMocks,
        ...(record === undefined
          ? { detailOmitted: true as const }
          : { run: { status: 'success' as const, record } }),
      },
    },
  };
}

/** A test that simulates the total and picks a scenario for the rates. */
const SCENARIO_TEST = {
  name: 'triples seven',
  input: { n: 7 },
  mocks: { total: { total: 21 } },
  scenarios: { fetch_rates: 'empty' },
};

/** Two of the scenarios Slack's channel lookup ships, as the editor's
 * catalog lists them. */
const GET_CHANNEL_SCENARIOS: readonly ConnectorScenarioSummary[] = [
  {
    name: 'one_channel',
    kind: 'success',
    description: 'Slack returns the channel.',
  },
  {
    name: 'channel_not_found',
    kind: 'error',
    description: 'Slack answers that no channel has this id.',
    when: { channel: 'C0000000009' },
  },
];

/** Only the channel lookup ships scenarios. */
function scenariosOf(nodeType: string): readonly ConnectorScenarioSummary[] {
  return nodeType === 'slack.get_channel' ? GET_CHANNEL_SCENARIOS : [];
}

/** An automation that looks a Slack channel up, then works out a total. */
const SLACK_DOC = {
  name: 'channel-check',
  nodes: [
    { id: 'get_channel', type: 'slack.get_channel' },
    { id: 'total', type: 'transform', code: 'return {};' },
  ],
};

/** A test of it with no stand-in yet. */
const CHANNEL_TEST = {
  name: 'finds the channel',
  input: { id: 'C0000000001' },
};

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

  it('lists a picked scenario as simulated, and says a call it never matched left it unused', () => {
    renderFields(
      withUnused(
        ['fetch_rates', 'total'],
        recordOf({ fetch_rates: 'succeeded', total: 'skipped' }),
      ),
      { test: SCENARIO_TEST },
    );
    expect(screen.getByText('Simulated: Total and Fetch rates')).toBeVisible();
    // The simulated total's node never ran; the rates' node ran, and none
    // of its calls matched the scenario.
    expect(
      screen.getByText('Not used: Total. The run skipped them.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Not used: the scenario picked for Fetch rates. A scenario answers only the calls whose input matches it, and none did.',
      ),
    ).toBeVisible();
  });

  it('says a picked scenario went unused because the run skipped its node, when the steps say so', () => {
    const { unmount } = renderFields(
      withUnused(
        ['fetch_rates'],
        recordOf({ fetch_rates: 'skipped', total: 'succeeded' }),
      ),
      { test: SCENARIO_TEST },
    );
    expect(
      screen.getByText('Not used: Fetch rates. The run skipped them.'),
    ).toBeVisible();
    expect(screen.queryByText(/scenario picked for/)).not.toBeInTheDocument();
    unmount();
    // A run too large to keep its steps cannot say which: no call matched
    // the scenario either way.
    renderFields(withUnused(['fetch_rates']), { test: SCENARIO_TEST });
    expect(
      screen.getByText(
        /^Not used: the scenario picked for Fetch rates\. A scenario answers/,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/The run skipped them/)).not.toBeInTheDocument();
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

  it('offers no other stand-in for a node the test picks a scenario for, and keeps the pick', async () => {
    const replace = vi.fn<Replace>();
    const picked = {
      name: 'triples seven',
      input: { n: 7 },
      scenarios: { fetch_rates: 'empty' },
    };
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: picked,
    });
    // A plain HTTP call ships no scenario: the pick shows as written, for
    // the check to say what is wrong with it.
    expect(
      screen.getByRole('button', { name: /^Scenario for Fetch rates/ }),
    ).toHaveTextContent('empty');
    await user.click(
      screen.getByRole('combobox', { name: 'Simulate a failure' }),
    );
    expect(
      screen.queryByRole('option', { name: 'Fetch rates' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('combobox', { name: "Simulate a node's output" }),
    );
    expect(
      screen.queryByRole('option', { name: 'Fetch rates' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Total' }));
    expect(replace).toHaveBeenLastCalledWith(0, {
      ...picked,
      mocks: { total: {} },
    });
  });

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

describe('a scenario in the test’s Setup', () => {
  /** The test with this scenario picked for the channel lookup. */
  const picking = (name: string) => ({
    ...CHANNEL_TEST,
    scenarios: { get_channel: name },
  });

  it('offers a scenario only for a node whose action ships one, and picks its first', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: CHANNEL_TEST,
      doc: SLACK_DOC,
      scenariosOf,
    });
    expect(screen.getByRole('region', { name: 'Scenarios' })).toHaveTextContent(
      'The node answers as in a scenario its action ships, instead of calling.',
    );
    await user.click(
      screen.getByRole('combobox', { name: 'Pick a scenario for a node' }),
    );
    // The total is code: it calls no action, so it has no scenario.
    expect(
      screen.queryByRole('option', { name: 'Total' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Get channel' }));
    expect(replace).toHaveBeenLastCalledWith(0, picking('one_channel'));
  });

  it('shows no Scenarios section where no action ships one', () => {
    renderFields(FAILED, { tab: 'setup', test: CHANNEL_TEST, doc: SLACK_DOC });
    expect(
      screen.queryByRole('region', { name: 'Scenarios' }),
    ).not.toBeInTheDocument();
  });

  it('lists each scenario with its kind and what it is, and changes the pick', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: picking('one_channel'),
      doc: SLACK_DOC,
      scenariosOf,
    });
    const field = screen.getByRole('button', {
      name: /^Scenario for Get channel/,
    });
    expect(field).toHaveTextContent('one_channel');
    expect(field).toHaveAccessibleDescription(
      'Success: Slack returns the channel.',
    );
    await user.click(field);
    const found = await screen.findByRole('option', { name: /^one_channel/ });
    expect(found).toHaveTextContent('Success');
    expect(found).toHaveTextContent('Slack returns the channel.');
    const notFound = screen.getByRole('option', {
      name: /^channel_not_found/,
    });
    expect(notFound).toHaveTextContent('Error');
    // Which calls it answers: only those that ask for that channel.
    expect(notFound).toHaveTextContent(
      'Slack answers that no channel has this id. Only for calls whose input has channel: "C0000000009". Any other call gets the usual simulated answer.',
    );
    await user.click(notFound);
    expect(replace).toHaveBeenLastCalledWith(0, picking('channel_not_found'));
  });

  it('picks by keyboard, finding a scenario by its kind', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: picking('one_channel'),
      doc: SLACK_DOC,
      scenariosOf,
    });
    screen.getByRole('button', { name: /^Scenario for Get channel/ }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard('error');
    await user.keyboard('{Enter}');
    expect(replace).toHaveBeenLastCalledWith(0, picking('channel_not_found'));
  });

  it('takes one stand-in a node: a picked scenario leaves no other, and goes when removed', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: picking('one_channel'),
      doc: SLACK_DOC,
      scenariosOf,
    });
    await user.click(
      screen.getByRole('combobox', { name: "Simulate a node's output" }),
    );
    expect(
      screen.queryByRole('option', { name: 'Get channel' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('combobox', { name: 'Simulate a failure' }),
    );
    expect(
      screen.queryByRole('option', { name: 'Get channel' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    // The lookup was the only node with scenarios, and it has its pick.
    expect(
      screen.queryByRole('combobox', { name: 'Pick a scenario for a node' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Remove Get channel' }),
    );
    expect(replace).toHaveBeenLastCalledWith(0, CHANNEL_TEST);
  });

  it.each([
    ['a simulated output', { mocks: { get_channel: { id: 'C0000000001' } } }],
    ['a simulated failure', { failures: { get_channel: 'Slack is down.' } }],
  ])('offers no scenario for a node that has %s', (_standIn, standIn) => {
    renderFields(FAILED, {
      tab: 'setup',
      test: { ...CHANNEL_TEST, ...standIn },
      doc: SLACK_DOC,
      scenariosOf,
    });
    expect(screen.getByRole('region', { name: 'Scenarios' })).toBeVisible();
    expect(
      screen.queryByRole('combobox', { name: 'Pick a scenario for a node' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a pick the action does not ship, as written, until another is picked', async () => {
    const replace = vi.fn<Replace>();
    const { user } = renderFields(FAILED, {
      tab: 'setup',
      replace,
      test: picking('archived'),
      doc: SLACK_DOC,
      scenariosOf,
    });
    const field = screen.getByRole('button', {
      name: /^Scenario for Get channel/,
    });
    expect(field).toHaveTextContent('archived');
    expect(field).not.toHaveAccessibleDescription();
    await user.click(field);
    // Choosing it again writes nothing.
    await user.click(await screen.findByRole('option', { name: 'archived' }));
    expect(replace).not.toHaveBeenCalled();
    await user.click(field);
    await user.click(
      await screen.findByRole('option', { name: /^one_channel/ }),
    );
    expect(replace).toHaveBeenLastCalledWith(0, picking('one_channel'));
  });

  it('shows a pick read-only, and no section without one', () => {
    const { unmount } = renderFields(FAILED, {
      tab: 'setup',
      readOnly: true,
      test: picking('one_channel'),
      doc: SLACK_DOC,
      scenariosOf,
    });
    expect(
      screen.getByRole('button', { name: /^Scenario for Get channel/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Remove Get channel' }),
    ).not.toBeInTheDocument();
    unmount();
    renderFields(FAILED, {
      tab: 'setup',
      readOnly: true,
      test: CHANNEL_TEST,
      doc: SLACK_DOC,
      scenariosOf,
    });
    expect(
      screen.queryByRole('region', { name: 'Scenarios' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a pick through Edit as YAML, both ways', async () => {
    const onTest = vi.fn();
    /** The inspector over a test it really edits, in either mode. */
    function RoundTrip() {
      const [test, setTest] = useState<unknown>(CHANNEL_TEST);
      const [mode, setMode] = useState<TestSetupMode>('form');
      const replace = (_index: number, next: unknown) => {
        setTest(next);
        onTest(next);
      };
      return (
        <TestFields
          headingId="test-heading"
          tests={{ ...controller(FAILED, replace), tests: [test] }}
          index={0}
          settledTest={test}
          issues={[]}
          diagnosticsStatus="ready"
          readOnly={false}
          tab="setup"
          onTabChange={vi.fn()}
          setupMode={mode}
          onSetupModeChange={setMode}
          doc={SLACK_DOC}
          text={{}}
          scenariosOf={scenariosOf}
          onSelectNode={vi.fn()}
        />
      );
    }
    const { user } = render(<RoundTrip />);
    await user.click(
      screen.getByRole('combobox', { name: 'Pick a scenario for a node' }),
    );
    await user.click(screen.getByRole('option', { name: 'Get channel' }));
    // The form's pick is the YAML's …
    await user.click(screen.getByRole('switch', { name: 'Edit as YAML' }));
    const yaml = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Test as YAML',
    });
    expect(yaml.value).toBe(testYaml(picking('one_channel')));
    expect(yaml.value).toContain('scenarios:\n  get_channel: one_channel');
    // … and a pick written as YAML is the form's, with its kind and what
    // it is.
    await user.click(yaml);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(testYaml(picking('channel_not_found')));
    await waitFor(() =>
      expect(onTest).toHaveBeenLastCalledWith(picking('channel_not_found')),
    );
    await user.click(screen.getByRole('switch', { name: 'Edit as YAML' }));
    const field = screen.getByRole('button', {
      name: /^Scenario for Get channel/,
    });
    expect(field).toHaveTextContent('channel_not_found');
    expect(field).toHaveAccessibleDescription(
      'Error: Slack answers that no channel has this id. Only for calls whose input has channel: "C0000000009". Any other call gets the usual simulated answer.',
    );
  });

  it('passes an accessibility audit with a pick and the picker', async () => {
    const { container } = renderFields(FAILED, {
      tab: 'setup',
      test: picking('channel_not_found'),
      doc: {
        ...SLACK_DOC,
        nodes: [
          ...SLACK_DOC.nodes,
          { id: 'find_owner', type: 'slack.get_channel' },
        ],
      },
      scenariosOf,
    });
    expect(
      screen.getByRole('combobox', { name: 'Pick a scenario for a node' }),
    ).toBeVisible();
    await checkAccessibility(container);
  });
});
