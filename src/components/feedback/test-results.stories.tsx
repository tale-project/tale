import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../primitives/button';
import {
  countTestStatuses,
  TestCountButton,
  TestCoverage,
  TestResultList,
  TestRunAnnouncer,
  type TestResultItem,
} from './test-results';

const ITEMS: TestResultItem[] = [
  {
    id: 'big-order',
    name: 'Big order gets a discount',
    status: 'failed',
    reason: 'The output differs from what the test expects in 1 place.',
    meta: '120 ms',
    badges: (
      <span className="bg-muted text-muted-foreground rounded px-1.5 text-xs">
        Simulates 2 nodes
      </span>
    ),
  },
  {
    id: 'small-order',
    name: 'Small order pays full price',
    status: 'passed',
    meta: '84 ms',
  },
  {
    id: 'no-customer',
    name: 'An order without a customer is refused',
    status: 'error',
    reason: 'The test couldn’t run: the input is not valid.',
  },
  {
    id: 'refund',
    name: 'A refund reverses the discount',
    status: 'stale',
    reason: 'The output differs from what the test expects in 2 places.',
    meta: '95 ms',
  },
  {
    id: 'gift-card',
    name: 'A gift card pays part of the order',
    status: 'not-run',
  },
];

const meta: Meta<typeof TestResultList> = {
  title: 'Feedback/TestResultList',
  component: TestResultList,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: `
The results of a run of tests, the toggle of a tests panel, the announcer that speaks a run, and how much of a
document its tests cover.

## Usage
\`\`\`tsx
import {
  TestCountButton,
  TestCoverage,
  TestResultList,
  TestRunAnnouncer,
  countTestStatuses,
} from '@tale/ui/test-results';

<TestResultList items={items} activeId={selected} onActivate={select} renderActions={menu} />
<TestCountButton counts={countTestStatuses(items.map((item) => item.status))} />
\`\`\`

## Accessibility
- One tab stop; ↑/↓, Home and End move between rows; a row's actions are reachable with Tab while it is current
- Every status has its own glyph and a visually hidden word ("Failed:")
- The announcer says "Running 3 tests…" and then the result, once per run
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TestResultList>;

function Interactive() {
  const [active, setActive] = useState<string | null>('big-order');
  return (
    <div className="bg-background w-[36rem] max-w-full rounded-md border">
      <TestResultList
        items={ITEMS}
        activeId={active}
        onActivate={(item) => setActive(item.id)}
      />
    </div>
  );
}

export const Default: Story = { render: () => <Interactive /> };

export const Static: Story = {
  render: () => (
    <div className="bg-background w-[36rem] max-w-full rounded-md border">
      <TestResultList items={ITEMS} aria-label="Tests of version 4" />
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="bg-background w-[36rem] max-w-full rounded-md border">
      <TestResultList items={[]} />
    </div>
  ),
};

export const Failed: Story = {
  render: () => (
    <div className="bg-background w-[36rem] max-w-full rounded-md border">
      <TestResultList items={ITEMS.slice(0, 2)} status="failed" />
    </div>
  ),
};

function RunAll() {
  const [items, setItems] = useState(ITEMS);
  const [run, setRun] = useState(0);
  const running = items.some(
    (item) => item.status === 'running' || item.status === 'queued',
  );
  // A waiting or running test has no result yet: no reason, no figure.
  const pending = (item: TestResultItem, status: 'queued' | 'running') => ({
    id: item.id,
    name: item.name,
    status,
  });
  const start = () => {
    setRun((previous) => previous + 1);
    setItems(
      ITEMS.map((item, index) =>
        pending(item, index === 0 ? 'running' : 'queued'),
      ),
    );
    ITEMS.forEach((result, index) => {
      setTimeout(
        () => {
          setItems((previous) =>
            previous.map((item, at) => {
              if (at === index) {
                return index === 0
                  ? result
                  : { ...result, status: 'passed', reason: undefined };
              }
              if (at === index + 1) return pending(item, 'running');
              return item;
            }),
          );
        },
        600 * (index + 1),
      );
    });
  };
  const counts = countTestStatuses(items.map((item) => item.status));
  return (
    <div className="bg-background w-[36rem] max-w-full space-y-2 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <TestCountButton
          counts={counts}
          status={running ? 'running' : 'idle'}
        />
        <Button size="sm" onClick={start} disabled={running}>
          Run all
        </Button>
      </div>
      <TestResultList
        items={items}
        onActivate={() => {}}
        status={running ? 'running' : 'ready'}
      />
      <TestRunAnnouncer
        counts={counts}
        status={running ? 'running' : 'idle'}
        announceKey={run}
      />
    </div>
  );
}

export const Running: Story = { render: () => <RunAll /> };

export const CountButton: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <TestCountButton
        counts={{
          passed: 2,
          failed: 1,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 3,
        }}
      />
      <TestCountButton
        counts={{
          passed: 4,
          failed: 0,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 4,
        }}
      />
      <TestCountButton
        counts={{
          passed: 0,
          failed: 0,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 0,
        }}
      />
      <TestCountButton
        counts={{
          passed: 2,
          failed: 1,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 3,
        }}
        status="running"
      />
      <TestCountButton
        counts={{
          passed: 2,
          failed: 1,
          error: 0,
          notRun: 0,
          stale: 0,
          total: 3,
        }}
        status="failed"
      />
    </div>
  ),
};

export const Coverage: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <TestCoverage covered={2} total={3} />
      <TestCoverage covered={3} total={3} onActivate={() => {}} />
      <TestCoverage covered={11} total={40} />
    </div>
  ),
};
