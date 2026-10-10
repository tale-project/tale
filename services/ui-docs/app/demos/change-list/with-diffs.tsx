import {
  ChangeList,
  FieldChangeRow,
  type ChangeSection,
} from '@tale/ui/change-list';
import { CodeDiff } from '@tale/ui/code-diff';
import { DataDiff } from '@tale/ui/data-diff';
import { Mail, Send, Sparkles } from 'lucide-react';

const PROMPT_V4 = `Score this issue from 1 to 5.
Say why in one sentence.
Answer in JSON.
`;

const PROMPT_V5 = `Score this issue from 1 to 5.
Say why in one sentence.
Suggest one label from the repository's labels.
Answer in JSON.
`;

const SECTIONS: ChangeSection[] = [
  {
    id: 'nodes',
    title: 'Nodes',
    items: [
      {
        id: 'score',
        kind: 'changed',
        title: 'Score',
        subtitle: 'Language model',
        summary: 'Prompt changed',
        icon: Sparkles,
        detail: (
          <FieldChangeRow
            label="Prompt"
            kind="changed"
            detail={
              <CodeDiff
                before={PROMPT_V4}
                after={PROMPT_V5}
                language="markdown"
                beforeLabel="v4"
                afterLabel="v5"
                toolbar={false}
                context={2}
                aria-label="Score's prompt, v4 against v5"
              />
            }
          />
        ),
      },
      {
        id: 'fetch',
        kind: 'changed',
        title: 'Fetch',
        subtitle: 'HTTP · Get',
        summary: 'Query changed',
        icon: Send,
        detail: (
          <FieldChangeRow
            label="Query"
            kind="changed"
            detail={
              <DataDiff
                before={{ state: 'open', per_page: 20 }}
                after={{ state: 'open', per_page: 50, sort: 'created' }}
                aria-label="Fetch's query, v4 against v5"
              />
            }
          />
        ),
      },
      {
        id: 'notify',
        kind: 'changed',
        title: 'Notify',
        subtitle: 'Email · Send',
        summary: 'Subject changed',
        icon: Mail,
        detail: (
          <FieldChangeRow
            label="Subject"
            kind="changed"
            layout="stacked"
            before="Weekly triage report for {{ input.repo }}"
            after="Triage report for {{ input.repo }}: {{ nodes.report.output.actionable }} to act on"
          />
        ),
      },
    ],
  },
];

export default function ChangeListWithDiffs() {
  return (
    <div className="bg-card w-full rounded-lg border p-3">
      <ChangeList
        sections={SECTIONS}
        aria-label="Changes from v4 to v5"
        defaultExpanded="all"
      />
    </div>
  );
}
