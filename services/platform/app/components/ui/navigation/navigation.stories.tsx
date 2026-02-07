import type { Meta, StoryObj } from '@storybook/react';
import {
  MessageCircle,
  Inbox,
  BrainIcon,
  CircleCheck,
  Network,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/app/components/ui/overlays/tooltip';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';
import { cn } from '@/lib/utils/cn';

// NOTE: The full Navigation component requires TanStack Router (Link, useLocation),
// useNavigationItems hook, and UserButton. These stories render a visual replica
// using the underlying NavigationMenu primitives to demonstrate the sidebar layout,
// tooltip behavior, and active/inactive states without those provider dependencies.

interface NavItemData {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
}

const sampleItems: NavItemData[] = [
  { label: 'Chat with AI', icon: MessageCircle },
  { label: 'Conversations', icon: Inbox, isActive: true },
  { label: 'Knowledge', icon: BrainIcon },
  { label: 'Approvals', icon: CircleCheck },
  { label: 'Automations', icon: Network },
];

function NavigationItemVisual({
  item,
}: {
  item: NavItemData;
}) {
  const Icon = item.icon;

  return (
    <NavigationMenuItem className="relative">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="block w-full"
              aria-label={item.label}
            >
              <div
                className={cn(
                  'relative flex items-center justify-center p-2 rounded-lg transition-colors',
                  item.isActive ? 'bg-muted' : 'hover:bg-muted',
                )}
                data-active={item.isActive}
              >
                <Icon
                  className={cn(
                    'size-5 shrink-0 text-muted-foreground',
                    item.isActive && 'text-foreground',
                  )}
                />
              </div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </NavigationMenuItem>
  );
}

function SidebarShell({
  items,
  showLogo = true,
}: {
  items: NavItemData[];
  showLogo?: boolean;
}) {
  return (
    <NavigationMenu className="flex flex-col bg-background border border-border h-[500px] w-14 rounded-lg">
      {showLogo && (
        <div className="flex-shrink-0 py-3 flex items-center justify-center">
          <div className="size-8 rounded bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
            T
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-4">
        <NavigationMenuList className="block space-y-2 space-x-0">
          {items.map((item) => (
            <NavigationItemVisual key={item.label} item={item} />
          ))}
        </NavigationMenuList>
      </div>
      <div className="flex-shrink-0 py-3 flex items-center justify-center">
        <div className="size-8 rounded-full bg-muted" />
      </div>
    </NavigationMenu>
  );
}

const meta: Meta = {
  title: 'Navigation/Sidebar',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The desktop sidebar navigation for the application. It displays icon-only navigation items with tooltips and active state highlighting.

## Provider dependencies
The full \`Navigation\` component requires TanStack Router (\`Link\`, \`useLocation\`), \`useNavigationItems\`, and \`UserButton\`. These stories use the underlying primitives to demonstrate the visual layout independently.

## Usage
\`\`\`tsx
import { Navigation } from '@/app/components/ui/navigation/navigation';

<Navigation organizationId="org_123" role="admin" />
\`\`\`

## Accessibility
- Each navigation item has a tooltip for screen readers and hover state
- Active item is visually highlighted with background color
- Icons use proper sizing and contrast
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <SidebarShell items={sampleItems} />,
};

export const NoActiveItem: Story = {
  render: () => (
    <SidebarShell
      items={sampleItems.map((item) => ({ ...item, isActive: false }))}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Sidebar with no active navigation item.',
      },
    },
  },
};

export const FirstItemActive: Story = {
  render: () => (
    <SidebarShell
      items={sampleItems.map((item, i) => ({
        ...item,
        isActive: i === 0,
      }))}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Chat item active, simulating the home/chat route.',
      },
    },
  },
};

export const AdminRole: Story = {
  render: () => <SidebarShell items={sampleItems} />,
  parameters: {
    docs: {
      description: {
        story: 'All items visible for admin role, including Automations.',
      },
    },
  },
};

export const MemberRole: Story = {
  render: () => (
    <SidebarShell items={sampleItems.filter((item) => item.label !== 'Automations')} />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Automations item is hidden for non-admin roles.',
      },
    },
  },
};

export const MinimalItems: Story = {
  render: () => (
    <SidebarShell
      items={[
        { label: 'Chat with AI', icon: MessageCircle, isActive: true },
        { label: 'Conversations', icon: Inbox },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Sidebar with only two navigation items.',
      },
    },
  },
};
