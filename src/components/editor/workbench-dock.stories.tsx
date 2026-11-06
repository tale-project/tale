import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../primitives/button';
import { WorkbenchDock, WorkbenchSheet } from './workbench-dock';

const meta: Meta<typeof WorkbenchDock> = {
  title: 'Editor/WorkbenchDock',
  component: WorkbenchDock,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: `
A panel docked under an editor's canvas — Problems, Tests — and the sheet that shows it where there is no room.

## Usage
\`\`\`tsx
import { WorkbenchDock, WorkbenchSheet } from '@tale/ui/workbench-dock';

<WorkbenchDock
  id="dock"
  panels={[{ id: 'problems', label: 'Problems', badge: '2 errors', content: <IssueList … /> }]}
  activeId="problems"
  closeLabel="Hide problems"
  onClose={close}
/>
\`\`\`

## Accessibility
- A region named by its title, or by its active tab
- Escape anywhere inside closes it; the host returns focus to the control that opened it
- Two or more panels are tabs: arrow keys move between them
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof WorkbenchDock>;

function Rows({ count, prefix }: { count: number; prefix: string }) {
  return (
    <ul className="divide-border divide-y text-sm">
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="px-3 py-2">
          {prefix} {index + 1}
        </li>
      ))}
    </ul>
  );
}

function Docked({ tabs }: { tabs: boolean }) {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState('problems');
  const [expanded, setExpanded] = useState(false);
  const panels = [
    {
      id: 'problems',
      label: 'Problems',
      badge: '2 errors',
      content: <Rows count={4} prefix="Problem" />,
    },
    {
      id: 'tests',
      label: 'Tests',
      badge: '2 passed, 1 failed',
      actions: (
        <Button size="sm" variant="secondary">
          Run all
        </Button>
      ),
      content: <Rows count={12} prefix="Test" />,
    },
  ];
  return (
    <div className="bg-muted/40 flex h-[32rem] w-[48rem] max-w-full flex-col rounded-md border">
      <div className="flex flex-1 items-center justify-center">
        <Button size="sm" onClick={() => setOpen((previous) => !previous)}>
          {open ? 'Hide the dock' : 'Show the dock'}
        </Button>
      </div>
      {open && (
        <WorkbenchDock
          id="story-dock"
          panels={tabs ? panels : panels.slice(0, 1)}
          activeId={active}
          onActiveChange={setActive}
          expanded={expanded}
          onExpandedChange={setExpanded}
          closeLabel="Hide the dock"
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export const OnePanel: Story = { render: () => <Docked tabs={false} /> };

export const Tabs: Story = { render: () => <Docked tabs /> };

function Sheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Show problems</Button>
      <WorkbenchSheet
        open={open}
        onOpenChange={setOpen}
        title="Problems"
        description="2 errors"
        closeLabel="Hide problems"
      >
        <Rows count={6} prefix="Problem" />
      </WorkbenchSheet>
    </>
  );
}

export const AsASheet: Story = { render: () => <Sheet /> };
