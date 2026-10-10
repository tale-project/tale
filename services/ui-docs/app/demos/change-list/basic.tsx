import {
  ChangeList,
  ChangeSummary,
  FieldChangeRow,
  type ChangeSection,
} from '@tale/ui/change-list';
import { Braces, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';

const SECTIONS: ChangeSection[] = [
  {
    id: 'start',
    title: 'Start (run inputs)',
    items: [
      {
        id: 'input:label',
        kind: 'added',
        title: 'label',
        subtitle: 'Run input',
        summary: 'Text, optional',
        detail: (
          <FieldChangeRow label="Type" kind="added" after="text, optional" />
        ),
      },
    ],
  },
  {
    id: 'nodes',
    title: 'Nodes',
    description: 'In the order they run.',
    items: [
      {
        id: 'score',
        kind: 'changed',
        title: 'Score',
        subtitle: 'Language model',
        summary: 'Model changed',
        icon: Sparkles,
        detail: (
          <FieldChangeRow
            label="Model"
            kind="changed"
            before="claude-haiku-4-5"
            after="claude-sonnet-4-5"
          />
        ),
      },
      {
        id: 'report',
        kind: 'renamed',
        title: 'Report',
        subtitle: 'Transform',
        summary: 'Was Summary',
        icon: Braces,
        detail: (
          <FieldChangeRow
            label="Name"
            kind="changed"
            before="Summary"
            after="Report"
            note="Also updated in the 1 node that reads it."
          />
        ),
      },
      {
        id: 'notify',
        kind: 'removed',
        title: 'Notify',
        subtitle: 'Email · Send',
        icon: Mail,
        detail: (
          <FieldChangeRow
            label="To"
            kind="removed"
            before="triage@example.com"
          />
        ),
      },
    ],
  },
  // A section with no changes is left out.
  { id: 'end', title: 'End (output)', items: [] },
];

export default function ChangeListBasic() {
  const [shown, setShown] = useState<string | null>(null);
  return (
    <div className="bg-card flex w-full flex-col gap-3 rounded-lg border p-3">
      <ChangeSummary
        counts={{ added: 1, removed: 1, changed: 1, renamed: 1 }}
        flags={['Inputs']}
        aria-label="Changes from v4 to v5"
      />
      <ChangeList
        sections={SECTIONS}
        aria-label="Changes from v4 to v5"
        defaultExpanded="first"
        activeId={shown}
        onActivate={(item) => setShown(item.id)}
        activateLabel="Show on the graph"
      />
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {shown === null
          ? 'Nothing shown on the graph yet.'
          : `Showing ${shown} on the graph.`}
      </p>
    </div>
  );
}
