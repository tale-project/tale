import { DataView, type DataViewMode } from '@tale/ui/data-view';
import type { SchemaTreeSchema } from '@tale/ui/schema-tree';
import { useState } from 'react';

const RETURNED = {
  summary: 'Login fails on Safari',
  score: '7',
  labels: [
    { name: 'bug', color: 'red' },
    { name: 'ui' },
    { name: 'safari', color: 'blue' },
  ],
  notes: 'Seen on every Safari release since 17.',
};

const EXPECTED: SchemaTreeSchema = {
  type: 'object',
  required: ['summary', 'score', 'priority'],
  properties: {
    summary: { type: 'string' },
    score: { type: 'number' },
    priority: { enum: ['low', 'normal', 'urgent'] },
    labels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, color: { type: 'string' } },
      },
    },
  },
};

export default function DataViewBasic() {
  const [mode, setMode] = useState<DataViewMode>('values');
  return (
    <div className="bg-card w-full max-w-xl rounded-lg border p-3">
      <DataView
        value={RETURNED}
        aria-label="Triage returned"
        mode={mode}
        onModeChange={setMode}
        expected={EXPECTED}
        expectedLabel="From the analysis of v4"
        recorded={{ bytes: 412 }}
        toolbar={{
          download: { fileName: 'triage-returned.json' },
          fullScreen: { title: 'What Triage returned' },
        }}
      />
    </div>
  );
}
