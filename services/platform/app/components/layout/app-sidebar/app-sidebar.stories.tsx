import type { Meta, StoryObj } from '@storybook/react';
import {
  SquarePen,
  Folder,
  BrainIcon,
  Bot,
  Workflow,
  Inbox,
  Settings,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  UserCircle,
} from 'lucide-react';

import { cn } from '@/lib/utils/cn';

// NOTE: The full AppSidebar requires TanStack Router, the SidebarProvider,
// Convex-backed chat history, and i18n. These stories render a static visual
// replica of both states to demonstrate the layout, row anatomy (36px icon
// tiles, h-9 rows, 13px labels), and active/inactive treatments without those
// provider dependencies.

interface NavItemData {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  badge?: number;
}

const sampleItems: NavItemData[] = [
  { label: 'New chat', icon: SquarePen },
  { label: 'Projects', icon: Folder },
  { label: 'Knowledge', icon: BrainIcon },
  { label: 'Agents', icon: Bot, isActive: true },
  { label: 'Automations', icon: Workflow },
  { label: 'Inbox', icon: Inbox, badge: 3 },
  { label: 'Settings', icon: Settings },
];

function NavRowVisual({
  item,
  expanded,
}: {
  item: NavItemData;
  expanded: boolean;
}) {
  const Icon = item.icon;
  return (
    <li className="relative">
      <button
        type="button"
        aria-label={item.label}
        className="inline-block cursor-pointer rounded-md text-left"
      >
        <div
          className={cn(
            'relative flex h-9 items-center gap-2.5 overflow-hidden rounded-md pr-2 pl-1.5 transition-colors',
            item.isActive
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          )}
          style={{ width: expanded ? '15.25rem' : '2.25rem' }}
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
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px]',
              expanded ? 'opacity-100' : 'opacity-0',
            )}
          >
            {item.label}
          </span>
        </div>
      </button>
    </li>
  );
}

function SidebarShell({
  expanded,
  pinned = false,
}: {
  expanded: boolean;
  /** md–lg viewport: the rail is pinned collapsed — logo instead of toggle. */
  pinned?: boolean;
}) {
  const ToggleIcon = expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <div
      className="bg-background border-border flex h-[560px] flex-col overflow-hidden rounded-lg border"
      style={{ width: expanded ? '16rem' : '3rem' }}
    >
      {/* Header — expanded: 36px logo box + name + toggle at the row's end;
          collapsed: only the toggle, in the leading icon column. */}
      <div className="shrink-0 px-1.5 pt-3 pb-4">
        <div className="flex h-9 items-center gap-2.5">
          {(expanded || pinned) && (
            <div className="bg-primary text-primary-foreground flex size-9 shrink-0 items-center justify-center rounded text-xs font-bold">
              T
            </div>
          )}
          {expanded && (
            <span className="text-foreground min-w-0 flex-1 truncate text-center text-sm font-semibold">
              Tale
            </span>
          )}
          {!pinned && (
            <button
              type="button"
              aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors"
            >
              <ToggleIcon className="size-5" />
            </button>
          )}
        </div>
      </div>
      {/* Search trigger */}
      <div className="shrink-0 px-1.5 pb-0.5">
        <button
          type="button"
          aria-label="Search chat"
          className={cn(
            'text-muted-foreground flex h-9 cursor-pointer items-center gap-2.5 overflow-hidden rounded-md border pl-2 transition-colors',
            expanded
              ? 'border-border bg-muted/50 hover:bg-muted pr-1.5'
              : 'hover:bg-muted border-transparent',
          )}
          style={{ width: expanded ? '15.25rem' : '2.25rem' }}
        >
          <Search className="size-5 shrink-0" />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[13px]',
              expanded ? 'opacity-100' : 'opacity-0',
            )}
          >
            Search chat
          </span>
          <kbd
            className={cn(
              'border-border bg-background text-muted-foreground shrink-0 rounded border px-1 font-sans text-[10px]',
              expanded ? 'opacity-100' : 'opacity-0',
            )}
          >
            ⌘ K
          </kbd>
        </button>
      </div>
      {/* Primary nav */}
      <nav aria-label="Main navigation" className="px-1.5">
        <ul className="flex list-none flex-col gap-0.5">
          {sampleItems.map((item) => (
            <NavRowVisual key={item.label} item={item} expanded={expanded} />
          ))}
        </ul>
      </nav>
      {/* Chats region */}
      <div className="border-border mt-2 min-h-0 flex-1 overflow-hidden border-t">
        {expanded && (
          <div className="px-2.5 py-3.5">
            <div className="text-muted-foreground/70 flex h-7 items-center px-2 text-[11px] tracking-wider uppercase">
              Chats
            </div>
            {[
              'Quarterly report draft',
              'Website copy review',
              'Team retro',
            ].map((title) => (
              <div
                key={title}
                className="text-foreground hover:bg-muted/60 flex min-h-6 cursor-pointer items-center rounded-md px-2 py-1.5 text-[13px]"
              >
                <span className="truncate">{title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Footer */}
      <div className="border-border flex shrink-0 flex-col gap-0.5 border-t px-1.5 py-2">
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
          className="text-muted-foreground hover:bg-muted flex h-9 cursor-pointer items-center gap-2.5 overflow-hidden rounded-md pr-2 pl-2 transition-colors"
          style={{ width: expanded ? '15.25rem' : '2.25rem' }}
        >
          <UserCircle className="size-5 shrink-0" />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[13px]',
              expanded ? 'opacity-100' : 'opacity-0',
            )}
          >
            Alex Rivera
          </span>
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
The unified app sidebar: primary navigation, chat search trigger, and chat history in one shell-level panel present on every dashboard route. Expanded it is an 16rem labelled panel; collapsed, a 3rem icon rail of 36×36 tiles. Icons hold their position across states — collapse is a clip plus a label fade, driven by \`--sidebar-width\` / \`--sidebar-width-collapsed\`.

## Provider dependencies
The full \`AppSidebar\` requires TanStack Router, \`SidebarProvider\`, and the Convex-backed chat history. These stories render a static visual replica of both states.

## Usage
\`\`\`tsx
import { AppSidebar } from '@/app/components/layout/app-sidebar/app-sidebar';

<AppSidebar organizationId="org_123" />
\`\`\`

## Accessibility
- Collapsed tiles keep their accessible names (\`aria-label\`) with right-side tooltips
- The toggle carries \`aria-expanded\` + \`aria-controls\`; ⌘H toggles globally
- The collapsed chat-history region is \`inert\` so clipped links leave the tab order
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Expanded: Story = {
  render: () => <SidebarShell expanded />,
};

export const Collapsed: Story = {
  render: () => <SidebarShell expanded={false} />,
  parameters: {
    docs: {
      description: {
        story:
          'The 3rem icon rail: 36×36 tiles, labels clipped and faded out, chat history hidden.',
      },
    },
  },
};

export const PinnedRail: Story = {
  render: () => <SidebarShell expanded={false} pinned />,
  parameters: {
    docs: {
      description: {
        story:
          'Between `md` and `lg` the rail is pinned collapsed: no expand toggle — the logo takes the leading slot instead.',
      },
    },
  },
};
