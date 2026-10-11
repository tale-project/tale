import { TestCoverage } from '@tale/ui/test-results';
import { useRef } from 'react';

// The paths a run can take, and whether a test goes down each.
const PATHS = [
  { id: 'urgent', words: 'The priority is urgent', tested: true },
  { id: 'normal', words: 'The priority is normal', tested: true },
  { id: 'low', words: 'Neither urgent nor normal', tested: false },
];

export default function TestResultsCoverage() {
  const list = useRef<HTMLUListElement>(null);
  const covered = PATHS.filter((path) => path.tested).length;
  return (
    <div className="flex w-full max-w-xl flex-col items-start gap-3">
      <TestCoverage
        covered={covered}
        total={PATHS.length}
        onActivate={() => list.current?.focus()}
      />
      <ul
        ref={list}
        tabIndex={-1}
        aria-label="Paths"
        className="bg-background focus-visible:ring-ring w-full divide-y rounded-lg border text-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {PATHS.map((path) => (
          <li key={path.id} className="flex justify-between gap-3 px-3 py-2">
            <span>{path.words}</span>
            <span className="text-muted-foreground">
              {path.tested ? 'Tested' : 'Not tested'}
            </span>
          </li>
        ))}
      </ul>
      <TestCoverage covered={11} total={40} />
    </div>
  );
}
