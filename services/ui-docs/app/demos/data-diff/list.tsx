import { DataDiff } from '@tale/ui/data-diff';

/** What a step received and what it returned. */
const RECEIVED = {
  title: 'Fix login',
  state: 'open',
  draft: 'Users report a loop on the login page.',
  labels: 'bug',
  assignee: { login: 'ada', team: 'core' },
  comments: 4,
};

const RETURNED = {
  title: 'Fix login on Safari',
  state: 'open',
  labels: ['bug', 'ui', 'safari'],
  assignee: { login: 'ada', team: 'web' },
  comments: 4,
  score: 7,
};

export default function DataDiffList() {
  return (
    <div className="bg-card w-full max-w-xl rounded-lg border p-3">
      <DataDiff
        before={RECEIVED}
        after={RETURNED}
        aria-label="Changes from received to returned"
      />
    </div>
  );
}
