import { DataDiff } from '@tale/ui/data-diff';

const PASS_2 = {
  status: 'pending',
  items: [
    { id: 1, title: 'Draft reply', score: 4 },
    { id: 2, title: 'Check refund', score: 6 },
  ],
};

const PASS_3 = {
  status: 'done',
  items: [
    { id: '1', title: 'Draft reply' },
    { id: '2', title: 'Check refund', reviewer: 'grace' },
  ],
  finishedAt: '2026-10-08T07:01:12Z',
};

export default function DataDiffShape() {
  return (
    <div className="bg-card w-full max-w-xl rounded-lg border p-3">
      <DataDiff
        before={PASS_2}
        after={PASS_3}
        mode="shape"
        aria-label="Shape changed since pass 2"
      />
    </div>
  );
}
