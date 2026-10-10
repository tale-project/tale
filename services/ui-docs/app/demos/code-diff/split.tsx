import { CodeDiff, type CodeDiffLayout } from '@tale/ui/code-diff';
import { useState } from 'react';

const BEFORE = `const issues = nodes.score.output;
const actionable = issues.filter((issue) => issue.priority >= 3);

return {
  reviewed: issues.length,
  actionable: actionable.length,
  issues: actionable.map((issue) => ({
    number: issue.number,
    title: issue.title,
    priority: issue.priority,
  })),
};
`;

const AFTER = `const issues = nodes.score.output;
const actionable = issues
  .filter((issue) => issue.priority >= 3)
  .toSorted((a, b) => b.priority - a.priority);

return {
  reviewed: issues.length,
  actionable: actionable.length,
  issues: actionable.map((issue) => ({
    number: issue.number,
    title: issue.title,
    priority: issue.priority,
    label: issue.label ?? 'triage',
  })),
};
`;

export default function CodeDiffSplit() {
  const [layout, setLayout] = useState<CodeDiffLayout>('split');
  return (
    // Side by side needs a 64rem container, wider than this page's column:
    // the stage scrolls sideways, and takes the keyboard to do it.
    <div
      role="region"
      aria-label="Report, side by side"
      tabIndex={0}
      className="focus-visible:ring-ring w-full overflow-x-auto rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="bg-card w-[66rem] p-4">
        <CodeDiff
          before={BEFORE}
          after={AFTER}
          language="javascript"
          beforeLabel="v4"
          afterLabel="v5"
          layout={layout}
          onLayoutChange={setLayout}
          aria-label="Report's code, v4 against v5"
        />
      </div>
    </div>
  );
}
