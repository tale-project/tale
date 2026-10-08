import { IssueList } from '@tale/ui/issue-list';

export default function IssueListStatic() {
  return (
    <div className="bg-background w-full max-w-sm rounded-lg border">
      <h3 id="node-problems" className="px-3 pt-3 text-sm font-medium">
        Problems in this node
      </h3>
      <IssueList
        aria-labelledby="node-problems"
        density="compact"
        issues={[
          {
            id: 'never-true',
            severity: 'warning',
            title: 'This condition is never true',
            location: 'Condition',
            fix: 'Compare against a value the field can hold.',
          },
        ]}
      />
    </div>
  );
}
