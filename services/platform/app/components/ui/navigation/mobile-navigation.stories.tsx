import type { Meta, StoryObj } from '@storybook/react';

import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  MessageCircle,
  Inbox,
  BrainIcon,
  CircleCheck,
  Network,
  Menu,
} from 'lucide-react';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { cn } from '@/lib/utils/cn';

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
} from './navigation-menu';

// NOTE: The full MobileNavigation component requires TanStack Router (Link, useLocation),
// useNavigationItems hook, and UserButton. These stories use a visual replica with the same
// underlying primitives to demonstrate the mobile drawer, sub-items, and role-based visibility.

interface SubItemData {
  label: string;
  isActive?: boolean;
}

interface NavItemData {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive?: boolean;
  subItems?: SubItemData[];
}

const sampleItems: NavItemData[] = [
  { label: 'Chat with AI', icon: MessageCircle },
  {
    label: 'Conversations',
    icon: Inbox,
    isActive: true,
    subItems: [
      { label: 'Open', isActive: true },
      { label: 'Closed' },
      { label: 'Spam' },
      { label: 'Archived' },
    ],
  },
  {
    label: 'Knowledge',
    icon: BrainIcon,
    subItems: [
      { label: 'Tone of voice' },
      { label: 'Documents' },
      { label: 'Websites' },
      { label: 'Products' },
      { label: 'Customers' },
      { label: 'Vendors' },
    ],
  },
  { label: 'Approvals', icon: CircleCheck },
  { label: 'Automations', icon: Network },
];

function MobileNavItemVisual({
  item,
  onClose,
}: {
  item: NavItemData;
  onClose: () => void;
}) {
  const Icon = item.icon;

  return (
    <NavigationMenuItem className="w-full">
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full text-left',
          item.isActive
            ? 'bg-muted text-foreground'
            : 'hover:bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5 shrink-0" />
        <span className="text-sm font-medium">{item.label}</span>
      </button>
      {item.subItems && item.isActive && (
        <div className="mt-2 ml-8 space-y-2">
          {item.subItems.map((subItem) => (
            <button
              key={subItem.label}
              type="button"
              onClick={onClose}
              className={cn(
                'block w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors',
                subItem.isActive
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {subItem.label}
            </button>
          ))}
        </div>
      )}
    </NavigationMenuItem>
  );
}

function MobileNavigationVisual({
  items,
  defaultOpen = false,
}: {
  items: NavItemData[];
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="left" className="w-72 p-0" hideClose>
          <VisuallyHidden.Root>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>Navigation menu</SheetDescription>
          </VisuallyHidden.Root>
          <NavigationMenu className="bg-background flex h-full w-full max-w-none flex-col">
            <div className="border-border flex h-14 flex-shrink-0 items-center border-b px-4 py-2">
              <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded text-xs font-bold">
                T
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <NavigationMenuList className="flex w-full flex-col space-y-2">
                {items.map((item) => (
                  <MobileNavItemVisual
                    key={item.label}
                    item={item}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </NavigationMenuList>
            </div>
            <div className="border-border flex h-14 flex-shrink-0 items-center border-t px-4 py-2">
              <div className="flex items-center gap-2">
                <div className="bg-muted size-8 rounded-full" />
                <span className="text-muted-foreground text-sm">Settings</span>
              </div>
            </div>
          </NavigationMenu>
        </SheetContent>
      </Sheet>
    </>
  );
}

const meta: Meta = {
  title: 'Navigation/MobileNavigation',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Mobile navigation drawer for smaller screens. Shows a hamburger menu button that opens a side sheet with navigation items, sub-items, and a user button.

## Provider dependencies
The full \`MobileNavigation\` component requires TanStack Router (\`Link\`, \`useLocation\`), \`useNavigationItems\`, and \`UserButton\`. These stories use the underlying primitives to demonstrate the visual layout independently.

## Usage
\`\`\`tsx
import { MobileNavigation } from '@/app/components/ui/navigation/mobile-navigation';

<MobileNavigation organizationId="org_123" role="admin" />
\`\`\`

## Features
- Hamburger menu button (visible on mobile only in production via md:hidden)
- Side sheet drawer from the left
- Navigation items with icons and labels
- Expandable sub-items for active sections
- Role-based item visibility
- User button in footer

## Accessibility
- Sheet has a visually hidden title and description
- Menu button has aria-label
- All items are keyboard accessible
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <MobileNavigationVisual items={sampleItems} />,
  parameters: {
    docs: {
      description: {
        story: 'Click the hamburger icon to open the mobile navigation drawer.',
      },
    },
  },
};

export const Open: Story = {
  render: () => <MobileNavigationVisual items={sampleItems} defaultOpen />,
  parameters: {
    docs: {
      description: {
        story:
          'Drawer shown in its open state with the Conversations section expanded.',
      },
    },
  },
};

export const WithKnowledgeActive: Story = {
  render: () => {
    const items: NavItemData[] = [
      { label: 'Chat with AI', icon: MessageCircle },
      { label: 'Conversations', icon: Inbox },
      {
        label: 'Knowledge',
        icon: BrainIcon,
        isActive: true,
        subItems: [
          { label: 'Tone of voice' },
          { label: 'Documents', isActive: true },
          { label: 'Websites' },
          { label: 'Products' },
          { label: 'Customers' },
          { label: 'Vendors' },
        ],
      },
      { label: 'Approvals', icon: CircleCheck },
      { label: 'Automations', icon: Network },
    ];

    return <MobileNavigationVisual items={items} defaultOpen />;
  },
  parameters: {
    docs: {
      description: {
        story: 'Knowledge section active with Documents sub-item highlighted.',
      },
    },
  },
};

export const MemberRole: Story = {
  render: () => {
    const items = sampleItems.filter((item) => item.label !== 'Automations');
    return <MobileNavigationVisual items={items} defaultOpen />;
  },
  parameters: {
    docs: {
      description: {
        story: 'Automations item hidden for non-admin users.',
      },
    },
  },
};

export const NoActiveItem: Story = {
  render: () => {
    const items: NavItemData[] = sampleItems.map((item) => ({
      ...item,
      isActive: false,
      subItems: item.subItems?.map((sub) => ({ ...sub, isActive: false })),
    }));
    return <MobileNavigationVisual items={items} defaultOpen />;
  },
  parameters: {
    docs: {
      description: {
        story:
          'All items in their default inactive state with sub-items collapsed.',
      },
    },
  },
};

export const MinimalItems: Story = {
  render: () => {
    const items: NavItemData[] = [
      { label: 'Chat with AI', icon: MessageCircle, isActive: true },
      { label: 'Conversations', icon: Inbox },
    ];
    return <MobileNavigationVisual items={items} defaultOpen />;
  },
  parameters: {
    docs: {
      description: {
        story: 'Minimal navigation with only two items.',
      },
    },
  },
};
