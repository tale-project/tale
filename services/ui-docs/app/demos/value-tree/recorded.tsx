import { ValueTree } from '@tale/ui/value-tree';

/** A step's input as a run recorded it: what was cut to keep it small and
 *  which secrets were hidden are listed beside the value, not written in. */
const RECORDED = {
  value: {
    to: 'support@example.com',
    subject: 'Weekly report',
    body: 'Hello team, here is the summary of this week. ',
    attachments: [
      { name: 'report.pdf', size: 48213 },
      { name: 'chart.png', size: 9120 },
    ],
    credentials: { user: 'reports', apiKey: null },
    raw: null,
  },
  elided: [
    { pointer: '/body', kind: 'string', dropped: 3412 },
    { pointer: '/attachments', kind: 'items', dropped: 18 },
    { pointer: '/raw', kind: 'depth', dropped: 52_000 },
  ],
  redacted: ['/credentials/apiKey'],
} as const;

export default function ValueTreeRecorded() {
  return (
    <div className="bg-card w-full max-w-xl rounded-lg border p-2">
      <ValueTree
        value={RECORDED.value}
        elided={RECORDED.elided}
        redacted={RECORDED.redacted}
        defaultExpandDepth={2}
        density="compact"
        aria-label="Send report input"
      />
    </div>
  );
}
