import { Button } from '@tale/ui/button';
import { IssueList, type IssueItem } from '@tale/ui/issue-list';
import { TestResultList, type TestResultItem } from '@tale/ui/test-results';
import { WorkbenchDock } from '@tale/ui/workbench-dock';
import { useRef, useState } from 'react';

const ISSUES: IssueItem[] = [
  {
    id: 'unknown-node',
    severity: 'error',
    title: 'Reads a node that does not exist',
    location: 'Draft reply › Prompt',
  },
  {
    id: 'never-true',
    severity: 'warning',
    title: 'This condition is never true',
    location: 'Triage › Condition',
  },
];

const RESULTS: TestResultItem[] = [
  {
    id: 'big-order',
    name: 'Big order gets a discount',
    status: 'failed',
    reason: 'The output differs from what the test expects in 1 place.',
    meta: '120 ms',
  },
  {
    id: 'small-order',
    name: 'Small order pays full price',
    status: 'passed',
    meta: '84 ms',
  },
];

export default function WorkbenchDockPanels() {
  const opener = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState('problems');
  const [expanded, setExpanded] = useState(false);

  const show = (panel: string, button: HTMLButtonElement) => {
    opener.current = button;
    setActive(panel);
    setOpen(true);
  };

  return (
    <div className="bg-muted/40 flex h-[30rem] w-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-background flex h-11 items-center gap-2 border-b px-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open && active === 'problems'}
          aria-controls={open ? 'workbench-dock-demo' : undefined}
          onClick={(event) => show('problems', event.currentTarget)}
        >
          Problems
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open && active === 'tests'}
          aria-controls={open ? 'workbench-dock-demo' : undefined}
          onClick={(event) => show('tests', event.currentTarget)}
        >
          Tests
        </Button>
      </div>
      <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-sm">
        The canvas
      </div>
      {open && (
        <WorkbenchDock
          id="workbench-dock-demo"
          panels={[
            {
              id: 'problems',
              label: 'Problems',
              badge: '1 error and 1 warning',
              content: <IssueList issues={ISSUES} onActivate={() => {}} />,
            },
            {
              id: 'tests',
              label: 'Tests',
              badge: '1 passed, 1 failed',
              actions: (
                <Button size="sm" variant="secondary">
                  Run all
                </Button>
              ),
              content: <TestResultList items={RESULTS} onActivate={() => {}} />,
            },
          ]}
          activeId={active}
          onActiveChange={setActive}
          expanded={expanded}
          onExpandedChange={setExpanded}
          closeLabel="Hide the panel"
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
    </div>
  );
}
