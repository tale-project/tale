import { IconButton } from '@tale/ui/icon-button';
import { TestResultList, type TestResultItem } from '@tale/ui/test-results';
import { Play } from 'lucide-react';
import { useState } from 'react';

const RESULTS: (TestResultItem & { name: string })[] = [
  {
    id: 'big-order',
    name: 'Big order gets a discount',
    status: 'failed',
    reason: 'The output differs from what the test expects in 1 place.',
    meta: '120 ms',
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
    reason: 'The input is missing customer.',
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

/** Each test's name as text, for the Run buttons' names. */
const NAMES = new Map(RESULTS.map((result) => [result.id, result.name]));

export default function TestResultsBasic() {
  const [items, setItems] = useState<TestResultItem[]>(RESULTS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId === null ? undefined : NAMES.get(activeId);

  // Runs one test again: it waits for its result without a reason or a
  // duration, then passes.
  const rerun = (id: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { id, name: item.name, status: 'running' } : item,
      ),
    );
    setTimeout(() => {
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? { id, name: item.name, status: 'passed', meta: '90 ms' }
            : item,
        ),
      );
    }, 900);
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="bg-background rounded-lg border">
        <TestResultList
          items={items}
          activeId={activeId}
          onActivate={(item) => setActiveId(item.id)}
          renderActions={(item, row) => (
            <IconButton
              icon={Play}
              size="sm"
              variant="ghost"
              tabIndex={row.tabIndex}
              aria-label={`Run ${NAMES.get(item.id) ?? ''}`}
              onClick={() => rerun(item.id)}
            />
          )}
        />
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {active === undefined
          ? 'Choose a test to show its result.'
          : `Showing ${active}.`}
      </p>
    </div>
  );
}
