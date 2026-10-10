import { DataDiff } from '@tale/ui/data-diff';

/** A connector call and its answer: they share no field to compare. */
const CALL = { to: 'support@example.com', subject: 'Weekly report' };
const ANSWER = [{ messageId: 'msg_51', accepted: true }];

export default function DataDiffUnrelated() {
  return (
    <div className="bg-card flex w-full max-w-xl flex-col gap-4 rounded-lg border p-3">
      <DataDiff before={CALL} after={ANSWER} aria-label="Call and answer" />
      <DataDiff
        before={{ status: 'open' }}
        after={{ status: 'open' }}
        aria-label="Two equal values"
        emptyMessage="The step returned what it received."
      />
    </div>
  );
}
