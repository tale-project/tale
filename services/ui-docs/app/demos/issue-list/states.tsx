import { IssueList, type IssueItem } from '@tale/ui/issue-list';
import {
  IssueAnnouncer,
  IssueCountButton,
  type IssueCheckStatus,
  type IssueCounts,
} from '@tale/ui/issue-summary';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { useState } from 'react';

// One error and two warnings, as the count button says.
const ISSUES: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
    fix: 'Read one of the nodes this automation has.',
  },
  {
    id: 'output-maybe-empty',
    severity: 'warning',
    title: 'Output may be empty',
    location: 'Automation output',
    fix: 'Also read a node that always runs.',
  },
  {
    id: 'condition-constant',
    severity: 'warning',
    title: 'Condition never changes',
    location: 'Triage › When',
    fix: 'Make the condition depend on data.',
  },
];

const COUNTS: Record<string, IssueCounts> = {
  problems: { errors: 1, warnings: 2 },
  none: { errors: 0, warnings: 0 },
};

export default function IssueListStates() {
  const [state, setState] = useState('problems');
  const [open, setOpen] = useState(true);
  const status: IssueCheckStatus =
    state === 'checking' ? 'checking' : state === 'failed' ? 'failed' : 'ready';
  const counts = COUNTS[state === 'none' ? 'none' : 'problems'];
  const issues = state === 'none' ? [] : ISSUES;
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <SegmentedControl
        aria-label="Check state"
        value={state}
        onValueChange={setState}
        options={[
          { value: 'problems', label: 'Problems' },
          { value: 'none', label: 'None' },
          { value: 'checking', label: 'Checking' },
          { value: 'failed', label: 'Failed' },
        ]}
      />
      <div className="bg-background rounded-lg border">
        <div className="flex h-9 items-center border-b px-1">
          <IssueCountButton
            counts={counts}
            status={status}
            expanded={open}
            controls="issue-states-panel"
            onClick={() => setOpen((value) => !value)}
          />
        </div>
        {open && (
          <div id="issue-states-panel">
            <IssueList issues={issues} status={status} onActivate={() => {}} />
          </div>
        )}
      </div>
      <IssueAnnouncer counts={counts} status={status} announceKey={state} />
    </div>
  );
}
