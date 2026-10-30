import { SegmentedControl } from '@tale/ui/segmented-control';
import { Inbox, Layers, ListChecks, MessageCircle } from 'lucide-react';
import { useState } from 'react';

const VIEWS = [
  { value: 'all', label: 'All', icon: Layers },
  {
    value: 'chats',
    label: 'Chats',
    icon: MessageCircle,
    attention: '2 items need you',
  },
  { value: 'tasks', label: 'Tasks', icon: ListChecks },
  { value: 'inbox', label: 'Inbox', icon: Inbox },
];

export default function TabsViewSwitcher() {
  const [view, setView] = useState('all');
  const shown = VIEWS.find((option) => option.value === view);
  return (
    <div className="flex w-70 flex-col gap-3">
      <SegmentedControl
        aria-label="Show"
        labels="selected"
        value={view}
        onValueChange={setView}
        options={VIEWS}
      />
      <p className="text-muted-foreground text-sm">
        The list below shows {shown?.label.toLowerCase()}.
      </p>
    </div>
  );
}
