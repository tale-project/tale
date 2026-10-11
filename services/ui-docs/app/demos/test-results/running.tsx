import { Button } from '@tale/ui/button';
import {
  TestCountButton,
  TestResultList,
  TestRunAnnouncer,
  countTestStatuses,
  type TestResultItem,
} from '@tale/ui/test-results';
import { useEffect, useState } from 'react';

const TESTS = [
  { id: 'big-order', name: 'Big order gets a discount' },
  { id: 'small-order', name: 'Small order pays full price' },
  { id: 'gift-card', name: 'A gift card pays part of the order' },
];

// What each test returns when it has run.
const RESULTS: Record<string, TestResultItem> = {
  'big-order': {
    id: 'big-order',
    name: 'Big order gets a discount',
    status: 'failed',
    reason: 'The output differs from what the test expects in 1 place.',
    meta: '120 ms',
  },
  'small-order': {
    id: 'small-order',
    name: 'Small order pays full price',
    status: 'passed',
    meta: '84 ms',
  },
  'gift-card': {
    id: 'gift-card',
    name: 'A gift card pays part of the order',
    status: 'passed',
    meta: '102 ms',
  },
};

/** A test without a result yet: its name and where it stands. */
function pending(
  test: { id: string; name: TestResultItem['name'] },
  status: TestResultItem['status'],
): TestResultItem {
  return { id: test.id, name: test.name, status };
}

export default function TestResultsRunning() {
  const [items, setItems] = useState<TestResultItem[]>(
    TESTS.map((test) => pending(test, 'not-run')),
  );
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(true);
  const running = items.some(
    (item) => item.status === 'running' || item.status === 'queued',
  );
  const counts = countTestStatuses(items.map((item) => item.status));

  // One test at a time: the next waiting test runs, then takes its result.
  useEffect(() => {
    const next = items.findIndex((item) => item.status === 'running');
    if (next === -1) return undefined;
    const timer = setTimeout(() => {
      setItems((current) =>
        current.map((item, index) => {
          if (index === next) return RESULTS[item.id] ?? item;
          if (index === next + 1) return pending(item, 'running');
          return item;
        }),
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [items]);

  const runAll = () => {
    setRun((current) => current + 1);
    setOpen(true);
    setItems(
      TESTS.map((test, index) =>
        pending(test, index === 0 ? 'running' : 'queued'),
      ),
    );
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="bg-background rounded-lg border">
        <div className="flex h-11 items-center gap-2 border-b px-2">
          <TestCountButton
            counts={counts}
            status={running ? 'running' : 'idle'}
            expanded={open}
            controls="test-results-running-panel"
            onClick={() => setOpen((value) => !value)}
          />
          <span className="flex-1" />
          <Button size="sm" onClick={runAll} disabled={running}>
            Run all
          </Button>
        </div>
        {open && (
          <div id="test-results-running-panel">
            <TestResultList
              items={items}
              status={running ? 'running' : 'ready'}
              onActivate={() => {}}
            />
          </div>
        )}
      </div>
      <TestRunAnnouncer
        counts={counts}
        status={running ? 'running' : 'idle'}
        announceKey={run}
      />
    </div>
  );
}
