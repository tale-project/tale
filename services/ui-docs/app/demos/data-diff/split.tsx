import { DataDiff, type DataDiffLayout } from '@tale/ui/data-diff';
import { useState } from 'react';

const RUN_A = {
  status: 'failed',
  attempts: 3,
  input: { repository: 'tale-project/tale', limit: 20 },
  issues: [
    { id: 11, title: 'Login fails on Safari', score: 7 },
    { id: 12, title: 'Docs typo', score: 2 },
  ],
};

const RUN_B = {
  status: 'succeeded',
  attempts: 1,
  input: { repository: 'tale-project/tale', limit: 50 },
  issues: [
    { id: 12, title: 'Docs typo', score: 2 },
    { id: 11, title: 'Login fails on Safari', score: 9 },
    { id: 13, title: 'Crash on save', score: 8 },
  ],
};

export default function DataDiffSplit() {
  const [layout, setLayout] = useState<DataDiffLayout>('split');
  return (
    <div className="bg-card w-full rounded-lg border p-3">
      <DataDiff
        before={RUN_A}
        after={RUN_B}
        layout={layout}
        onLayoutChange={setLayout}
        labels={{ before: 'Run A', after: 'Run B' }}
        aria-label="Run A against run B"
      />
    </div>
  );
}
