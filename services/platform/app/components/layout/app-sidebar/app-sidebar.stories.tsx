import type { Meta, StoryObj } from '@storybook/react';
import {
  MessageCircle,
  Folder,
  BrainIcon,
  Bot,
  Workflow,
  Inbox,
  Settings,
  Bell,
  UserCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils/cn';

// NOTE: The full AppSidebar requires TanStack Router, the SidebarProvider,
// and i18n. This story renders a static visual replica of the rail to
// demonstrate the layout, tile anatomy (36px icon tiles, 20px glyphs), and
// active/inactive treatments without those provider dependencies.

interface NavItemData {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  badge?: number;
}

const sampleItems: NavItemData[] = [
  { label: 'Chat', icon: MessageCircle, isActive: true },
  { label: 'Projects', icon: Folder },
  { label: 'Knowledge', icon: BrainIcon },
  { label: 'Agents', icon: Bot },
  { label: 'Automations', icon: Workflow },
  { label: 'Inbox', icon: Inbox, badge: 3 },
  { label: 'Settings', icon: Settings },
];

function NavTileVisual({ item }: { item: NavItemData }) {
  const Icon = item.icon;
  return (
    <li className="relative">
      <button
        type="button"
        aria-label={item.label}
        className="inline-block cursor-pointer rounded-md"
      >
        <div
          className={cn(
            'relative flex size-9 items-center justify-center rounded-md transition-colors',
            item.isActive
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
          data-active={item.isActive}
        >
          <span className="relative flex size-5 shrink-0 items-center justify-center">
            <Icon className="size-5 shrink-0" />
            {item.badge !== undefined && item.badge > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-medium tabular-nums">
                {item.badge}
              </span>
            )}
          </span>
        </div>
      </button>
    </li>
  );
}

function RailShell() {
  return (
    <div
      className="bg-background border-border flex h-[560px] flex-col overflow-hidden rounded-lg border px-2"
      style={{ width: '3.25rem' }}
    >
      {/* Header: the org logo tile (links to a fresh chat in the real rail) */}
      <div className="shrink-0 pt-3 pb-4">
        <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded text-xs font-bold">
          T
        </div>
      </div>
      {/* Primary nav tiles */}
      <nav aria-label="Main navigation">
        <ul className="flex list-none flex-col gap-2">
          {sampleItems.map((item) => (
            <NavTileVisual key={item.label} item={item} />
          ))}
        </ul>
      </nav>
      {/* Flexible spacer — section content lives in per-route sub-panels */}
      <div className="min-h-0 flex-1" />
      {/* Footer */}
      <div className="border-border flex shrink-0 flex-col gap-2 border-t py-2">
        <button
          type="button"
          aria-label="Notifications"
          className="text-muted-foreground hover:bg-muted flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors"
        >
          <Bell className="size-5" />
        </button>
        <button
          type="button"
          aria-label="Manage account"
          className="text-muted-foreground hover:bg-muted flex size-9 cursor-pointer items-center justify-center rounded-md transition-colors"
        >
          <UserCircle className="size-5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

const meta: Meta = {
  title: 'Navigation/AppSidebar',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The app sidebar: a permanent 52px icon rail of primary destinations, present on every dashboard route. Each 36×36 tile carries its label as an \`aria-label\` with a right-side tooltip; section content (chat history, settings navigation) lives in per-route sub-panels built on \`SubPanel\`. Driven by \`--sidebar-width-collapsed\`.

## Provider dependencies
The full \`AppSidebar\` requires TanStack Router, \`SidebarProvider\`, and i18n. This story renders a static visual replica.

## Usage
\`\`\`tsx
import { AppSidebar } from '@/app/components/layout/app-sidebar/app-sidebar';

<AppSidebar organizationId="org_123" />
\`\`\`

## Accessibility
- Tiles keep their accessible names (\`aria-label\`) with right-side tooltips
- Unread counts render as chips on the tile icon with a numeric \`aria-label\`
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Rail: Story = {
  render: () => <RailShell />,
};
