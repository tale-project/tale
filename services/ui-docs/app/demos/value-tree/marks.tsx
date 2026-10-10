import {
  ValueTree,
  type ValueMark,
  type ValueMarkKind,
  type ValueMarks,
} from '@tale/ui/value-tree';

const OUTPUT = {
  summary: 'Login fails on Safari',
  score: 7,
  labels: ['bug', 'ui'],
  priority: 2,
  customer: { name: 'Acme', plan: 'pro' },
};

const MARKS: ValueMarks = new Map<string, ValueMarkKind | ValueMark>([
  ['/score', 'added'],
  ['/labels', { kind: 'type-changed', before: 'bug' }],
  ['/priority', { kind: 'changed', before: 1 }],
  ['/customer', 'focus'],
  ['/customer/region', 'missing'],
]);

export default function ValueTreeMarks() {
  return (
    <div className="bg-card w-full max-w-xl rounded-lg border p-2">
      <ValueTree value={OUTPUT} marks={MARKS} aria-label="Triage output" />
    </div>
  );
}
