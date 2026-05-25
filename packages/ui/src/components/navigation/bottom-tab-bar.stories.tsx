import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Bot,
  CalendarClock,
  FileText,
  MessageSquare,
  Settings,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { BottomTabBar } from './bottom-tab-bar';

const meta: Meta<typeof BottomTabBar> = {
  title: 'Navigation/BottomTabBar',
  component: BottomTabBar,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile1' },
    docs: {
      description: {
        component:
          'Fixed bottom navigation for mobile. Tap a tab to make it active — the pill background and label color update accordingly. Honors `env(safe-area-inset-bottom)`. Hidden on `md+` viewports.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof BottomTabBar>;

const TABS = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'automations', label: 'Automations', icon: CalendarClock },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'settings', label: 'Settings', icon: Settings },
];

interface InteractiveShellProps {
  initialKey: string;
  slice?: number;
  badges?: Record<string, ReactNode>;
  accentColor?: string;
}

function InteractiveShell({
  initialKey,
  slice,
  badges,
  accentColor,
}: InteractiveShellProps) {
  const [activeKey, setActiveKey] = useState(initialKey);
  const available = slice ? TABS.slice(0, slice) : TABS;
  const items = available.map((tab) => ({
    key: tab.key,
    label: tab.label,
    icon: tab.icon,
    active: activeKey === tab.key,
    badge: badges?.[tab.key],
    accentColor: accentColor && activeKey === tab.key ? accentColor : undefined,
    onSelect: () => setActiveKey(tab.key),
  }));
  return (
    <div className="bg-background relative min-h-[420px] w-full">
      <div className="text-muted-foreground px-4 py-6 text-sm">
        Active tab:{' '}
        <span className="text-foreground font-semibold">{activeKey}</span>. Tap
        any tab below to switch.
      </div>
      <BottomTabBar items={items} ariaLabel="Primary" className="relative" />
    </div>
  );
}

export const FiveTabs: Story = {
  render: () => <InteractiveShell initialKey="chat" />,
  parameters: {
    docs: {
      description: {
        story:
          'Five primary destinations. Click any tab to make it active — the pill background animates on the selected icon.',
      },
    },
  },
};

export const FourTabs: Story = {
  render: () => <InteractiveShell initialKey="automations" slice={4} />,
  parameters: {
    docs: {
      description: {
        story:
          'Four tabs — the tabs stretch evenly across the available width.',
      },
    },
  },
};

export const WithBadges: Story = {
  render: () => (
    <InteractiveShell
      initialKey="chat"
      badges={{ agents: 3, documents: '!' }}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Badges appear in the upper-right corner of the icon — numeric counts or single-character alerts. Hidden from assistive tech (the parent button label already announces the count).',
      },
    },
  },
};

export const WithAccentColor: Story = {
  render: () => <InteractiveShell initialKey="chat" accentColor="#7c3aed" />,
  parameters: {
    docs: {
      description: {
        story:
          'When the org sets a brand accent color, the active tab uses that color (text + tinted pill background) instead of the muted token.',
      },
    },
  },
};
