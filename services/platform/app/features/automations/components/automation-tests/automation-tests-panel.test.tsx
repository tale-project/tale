import type { TestResultListHandle } from '@tale/ui/test-results';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TransientRecord } from '@/lib/engine/core/record/transient';
import { render, screen, within } from '@/tests/utils/render';

import type {
  AutomationTests,
  TestRow,
} from '../../hooks/use-automation-tests';
import {
  AutomationTestsSheet,
  TestsPanelActions,
  TestsPanelContent,
  type AddTestSources,
} from './automation-tests-panel';

function row(overrides: Partial<TestRow> & { index: number }): TestRow {
  return {
    id: `test-${overrides.index}`,
    name: `Test ${overrides.index + 1}`,
    status: 'not-run',
    outcome: { kind: 'none' },
    badges: [],
    ...overrides,
  };
}

function controller(overrides: Partial<AutomationTests> = {}): AutomationTests {
  const rows = overrides.rows ?? [
    row({
      index: 0,
      name: 'doubles seven',
      status: 'passed',
      meta: '3 ms',
    }),
    row({
      index: 1,
      name: 'triples seven',
      status: 'failed',
      reason: 'The output differs from what the test expects in 1 place.',
      meta: '4 ms',
      badges: ['Simulates 1 node'],
    }),
  ];
  return {
    tests: rows.map(() => ({})),
    rows,
    counts: { passed: 1, failed: 1, error: 0, notRun: 0, stale: 0, total: 2 },
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
    add: vi.fn(() => 2),
    duplicate: vi.fn(() => 1),
    remove: vi.fn(),
    replace: vi.fn(),
    ...overrides,
  };
}

function renderPanel(
  tests: AutomationTests,
  props: {
    canEdit?: boolean;
    addFrom?: AddTestSources;
    coverage?: { covered: number; total: number; onShowPaths?: () => void };
    onShowRun?: (index: number) => void;
  } = {},
) {
  const onOpen = vi.fn();
  const onAdd = vi.fn();
  const onDeleted = vi.fn();
  const view = render(
    <>
      <TestsPanelActions
        tests={tests}
        canEdit={props.canEdit ?? true}
        onAdd={onAdd}
        {...(props.addFrom !== undefined && { addFrom: props.addFrom })}
      />
      <TestsPanelContent
        tests={tests}
        canEdit={props.canEdit ?? true}
        activeIndex={null}
        onOpen={onOpen}
        onAdd={onAdd}
        onDeleted={onDeleted}
        listRef={createRef<TestResultListHandle>()}
        {...(props.addFrom !== undefined && { addFrom: props.addFrom })}
        {...(props.coverage !== undefined && { coverage: props.coverage })}
        {...(props.onShowRun !== undefined && { onShowRun: props.onShowRun })}
      />
    </>,
  );
  return { ...view, onOpen, onAdd, onDeleted };
}

/** A run's record as a test's result keeps it: only that it is kept
 * matters to the panel. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a record built by hand, with none of the steps the panel never reads
const RECORD = {
  view: { nodes: [] },
  details: [],
} as unknown as TransientRecord;

describe('the Tests sheet', () => {
  it('carries what the page said behind it in its own description, which a modal sheet hides the page from', () => {
    render(
      <AutomationTestsSheet
        open
        onOpenChange={() => {}}
        tests={controller()}
        canEdit
        activeIndex={null}
        onOpen={() => {}}
        onAdd={() => {}}
        onDeleted={() => {}}
        listRef={createRef<TestResultListHandle>()}
        notice="This version was not deployed. One of its tests fails. Tests shows which."
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Tests' }),
    ).toHaveAccessibleDescription(
      /1 passed, 1 failed This version was not deployed\. One of its tests fails\./,
    );
  });

  it('describes only its counts when nothing stands behind it', () => {
    render(
      <AutomationTestsSheet
        open
        onOpenChange={() => {}}
        tests={controller()}
        canEdit
        activeIndex={null}
        onOpen={() => {}}
        onAdd={() => {}}
        onDeleted={() => {}}
        listRef={createRef<TestResultListHandle>()}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Tests' }),
    ).not.toHaveAccessibleDescription(/not deployed/);
  });
});

describe('the Tests panel', () => {
  it('lays a test’s run over the canvas from its row, when its result keeps the steps', async () => {
    const onShowRun = vi.fn();
    const tests = controller({
      rows: [
        row({ index: 0, name: 'doubles seven', status: 'passed' }),
        row({
          index: 1,
          name: 'triples seven',
          status: 'failed',
          outcome: {
            kind: 'run',
            stale: false,
            at: 1,
            result: {
              name: 'triples seven',
              index: 1,
              pass: false,
              ms: 4,
              failures: [],
              run: { status: 'success', record: RECORD },
            },
          },
        }),
      ],
    });
    const { user } = renderPanel(tests, { onShowRun });
    await user.click(
      screen.getByRole('button', { name: 'More for doubles seven' }),
    );
    expect(
      screen.queryByRole('menuitem', { name: 'Show on the canvas' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: 'More for triples seven' }),
    );
    await user.click(
      screen.getByRole('menuitem', { name: 'Show on the canvas' }),
    );
    expect(onShowRun).toHaveBeenCalledWith(1);
  });

  it('lists each test with its status, its first failure and what it simulates', () => {
    renderPanel(controller());
    const list = screen.getByRole('list', { name: 'Tests of this automation' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Passed: doubles seven');
    expect(rows[0]).toHaveTextContent('3 ms');
    expect(rows[1]).toHaveTextContent('Failed: triples seven');
    expect(rows[1]).toHaveTextContent(
      'The output differs from what the test expects in 1 place.',
    );
    expect(rows[1]).toHaveTextContent('Simulates 1 node');
    expect(screen.getByText('Run on your draft')).toBeVisible();
  });

  it('opens a test from its row, and runs all of them', async () => {
    const tests = controller();
    const { user, onOpen } = renderPanel(tests);
    await user.click(
      screen.getByRole('button', { name: /Failed: triples seven/ }),
    );
    expect(onOpen).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Run all' }));
    expect(tests.runAll).toHaveBeenCalledOnce();
  });

  it('runs, copies and deletes a test from its menu, and says a deletion', async () => {
    const tests = controller();
    const { user, onOpen, onDeleted } = renderPanel(tests);
    const menu = () =>
      screen.getByRole('button', { name: 'More for triples seven' });
    await user.click(menu());
    await user.click(screen.getByRole('menuitem', { name: 'Run' }));
    expect(tests.runOne).toHaveBeenCalledWith(1);

    await user.click(menu());
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    expect(tests.duplicate).toHaveBeenCalledWith(1);
    // The copy opens, ready to be changed.
    expect(onOpen).toHaveBeenCalledWith(1);

    await user.click(menu());
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(tests.remove).toHaveBeenCalledWith(1);
    expect(onDeleted).toHaveBeenCalledWith('triples seven');
  });

  it('waits with Run while tests run, and says why', () => {
    renderPanel(
      controller({
        status: 'running',
        runDisabledReason: 'The tests are running.',
      }),
    );
    expect(screen.getByRole('button', { name: /Run all/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('says why the last run did not finish', () => {
    renderPanel(
      controller({
        failure: {
          title: 'Many tests ran just now. Try again in 3 seconds.',
          retryAt: Date.now() + 3_000,
        },
      }),
    );
    expect(
      screen.getByText('Many tests ran just now. Try again in 3 seconds.'),
    ).toBeVisible();
    // The wait is the way: no Try again beside it.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers to try again after a run that failed, not while a budget is spent', async () => {
    const tests = controller({
      status: 'failed',
      failure: {
        title: "Couldn't run the tests.",
        description: 'The connection to Tale was lost.',
      },
    });
    const { user } = renderPanel(tests);
    expect(screen.getByText('The connection to Tale was lost.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(tests.retry).toHaveBeenCalledOnce();
  });

  it('says the results could not be loaded, with Try again, in place of a list that would call every test not run yet', async () => {
    const retry = vi.fn();
    const tests = controller({
      rows: [row({ index: 0, name: 'smoke' }), row({ index: 1, name: 'big' })],
      counts: { passed: 0, failed: 0, error: 0, notRun: 0, stale: 0, total: 2 },
      source: 'Not run yet',
      reportFailure: { failureCount: 1, retrying: false, retry },
    });
    const { user } = renderPanel(tests, {
      coverage: { covered: 0, total: 3 },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the test results",
    );
    expect(screen.queryByText(/Not run yet/)).toBeNull();
    expect(screen.queryByText(/Covers 0 of 3 paths/)).toBeNull();
    expect(
      screen.queryByRole('list', { name: 'Tests of this automation' }),
    ).toBeNull();
    // What does not need the results stays: running the tests, adding one.
    expect(screen.getByRole('button', { name: 'Run all' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('adds a blank test, one from the trigger, or one for an untested path', async () => {
    const trigger = vi.fn();
    const path = vi.fn();
    const { user, onAdd } = renderPanel(controller(), {
      addFrom: {
        trigger,
        paths: [
          {
            id: 'when:triage=0',
            label: 'Path 3: Triage is skipped',
            onSelect: path,
          },
        ],
      },
    });
    const add = () => screen.getByRole('button', { name: 'Add test' });
    await user.click(add());
    await user.click(screen.getByRole('menuitem', { name: 'Blank test' }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(add());
    await user.click(
      screen.getByRole('menuitem', { name: "From the trigger's input" }),
    );
    expect(trigger).toHaveBeenCalledOnce();
    // The paths are a submenu: open it from the keyboard, as a pointer
    // leaving its trigger in a test closes it again.
    await user.click(add());
    screen.getByRole('menuitem', { name: 'For an untested path' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(
      await screen.findByRole('menuitem', {
        name: 'Path 3: Triage is skipped',
      }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(path).toHaveBeenCalledOnce();
  });

  it('says when every path has a test', async () => {
    const { user } = renderPanel(controller(), { addFrom: { paths: [] } });
    await user.click(screen.getByRole('button', { name: 'Add test' }));
    expect(
      screen.getByRole('menuitem', { name: 'Every path has a test' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('counts the paths the tests go down, and opens the Paths list', async () => {
    const onShowPaths = vi.fn();
    const { user } = renderPanel(controller(), {
      coverage: { covered: 2, total: 3, onShowPaths },
    });
    await user.click(
      screen.getByRole('button', { name: /Covers 2 of 3 paths/ }),
    );
    expect(onShowPaths).toHaveBeenCalledOnce();
  });

  it('invites the first test when there is none', async () => {
    const { user, onAdd } = renderPanel(
      controller({
        rows: [],
        tests: [],
        counts: {
          passed: 0,
          failed: 0,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 0,
        },
      }),
    );
    expect(screen.getByRole('heading', { name: 'No tests yet' })).toBeVisible();
    // No Run all without tests; Add test in the header and in the empty
    // state alike.
    expect(screen.queryByRole('button', { name: 'Run all' })).toBeNull();
    const adds = screen.getAllByRole('button', { name: 'Add test' });
    expect(adds).toHaveLength(2);
    await user.click(adds[1]!);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('offers a member no verbs', () => {
    renderPanel(controller(), { canEdit: false });
    expect(screen.queryByRole('button', { name: 'Run all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add test' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'More for triples seven' }),
    ).toBeNull();
  });
});
