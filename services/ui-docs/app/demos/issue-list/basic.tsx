import { IssueList, type IssueItem } from '@tale/ui/issue-list';
import { useState } from 'react';

const ISSUES: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
    explanation: 'A template can only read the nodes of this automation.',
    cause: 'The prompt reads "nope", and there is no node with that id.',
    fix: 'Read one of the nodes this automation has, such as "triage".',
    code: 'REF_UNKNOWN_NODE',
    technical: 'nodes.nope is not a node of this automation',
    docsHref: 'https://docs.tale.dev/platform/automations/concepts',
  },
  {
    id: 'maybe-empty',
    severity: 'warning',
    title: 'The output can be empty',
    location: 'Automation output',
    explanation: 'A skipped node has no output, so the result can be empty.',
    cause:
      'The output reads only "draft reply", which is skipped when the triage says no.',
    fix: 'Give the output a fallback value.',
    code: 'OUTPUT_MAYBE_EMPTY',
    unavailableReason: 'Change the output in the YAML view.',
  },
  {
    id: 'never-true',
    severity: 'warning',
    title: 'This condition is never true',
    location: 'Triage › Condition',
    fix: 'Compare against a value the field can hold.',
    code: 'CONDITION_CONSTANT',
  },
];

export default function IssueListBasic() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = ISSUES.find((issue) => issue.id === activeId);
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="bg-background rounded-lg border">
        <IssueList
          issues={ISSUES}
          activeId={activeId}
          onActivate={(issue) => setActiveId(issue.id)}
        />
      </div>
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {active === undefined ? (
          'Choose a problem to go to it.'
        ) : (
          <>Went to {active.location}.</>
        )}
      </p>
    </div>
  );
}
