import type { Meta, StoryObj } from '@storybook/react';

import { CirculyIcon } from './circuly-icon';
import { EnterKeyIcon } from './enter-key-icon';
import { GmailIcon } from './gmail-icon';
import { LocaleIcon } from './locale-icon';
import { MicrosoftIcon } from './microsoft-icon';
import { OneDriveIcon } from './onedrive-icon';
import { OutlookIcon } from './outlook-icon';
import { ProtelIcon } from './protel-icon';
import { ShopifyIcon } from './shopify-icon';
import { WebsiteIcon } from './website-icon';

const icons = [
  {
    name: 'MicrosoftIcon',
    component: MicrosoftIcon,
    description: 'Microsoft brand icon',
  },
  {
    name: 'ShopifyIcon',
    component: ShopifyIcon,
    description: 'Shopify e-commerce platform',
  },
  {
    name: 'CirculyIcon',
    component: CirculyIcon,
    description: 'Circuly subscription platform',
  },
  {
    name: 'ProtelIcon',
    component: ProtelIcon,
    description: 'Protel PMS hotel management',
  },
  {
    name: 'GmailIcon',
    component: GmailIcon,
    description: 'Gmail email service',
  },
  {
    name: 'OutlookIcon',
    component: OutlookIcon,
    description: 'Microsoft Outlook',
  },
  {
    name: 'OneDriveIcon',
    component: OneDriveIcon,
    description: 'Microsoft OneDrive storage',
  },
  {
    name: 'LocaleIcon',
    component: LocaleIcon,
    description: 'Language/locale selection',
  },
  {
    name: 'WebsiteIcon',
    component: WebsiteIcon,
    description: 'Website/browser icon',
  },
  {
    name: 'EnterKeyIcon',
    component: EnterKeyIcon,
    description: 'Keyboard enter key',
  },
];

const meta: Meta = {
  title: 'Icons/All Icons',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
All custom brand and utility icons used in the application.

## Usage
\`\`\`tsx
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';

<div className="size-6">
  <MicrosoftIcon />
</div>
\`\`\`

## Accessibility
- All icons include \`aria-hidden="true"\` or \`aria-label\` for screen readers
- Icons used as buttons should be wrapped with accessible button elements
        `,
      },
    },
  },
};

export default meta;

export const AllIcons: StoryObj = {
  render: () => (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {icons.map(({ name, component: Icon, description }) => (
        <div
          key={name}
          className="border-border hover:bg-muted/50 flex flex-col items-center gap-3 rounded-lg border p-4 transition-colors"
        >
          <div className="flex size-12 items-center justify-center">
            <div className="size-8">
              <Icon />
            </div>
          </div>
          <div className="text-center">
            <p className="text-foreground text-sm font-medium">{name}</p>
            <p className="text-muted-foreground text-xs">{description}</p>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const IconSizes: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      {(['size-4', 'size-6', 'size-8', 'size-12', 'size-16'] as const).map(
        (size) => (
          <div key={size} className="flex items-center gap-4">
            <span className="text-muted-foreground w-20 text-sm">{size}</span>
            <div className="flex items-center gap-4">
              <div className={size}>
                <MicrosoftIcon />
              </div>
              <div className={size}>
                <GmailIcon />
              </div>
              <div className={size}>
                <ShopifyIcon />
              </div>
              <div className={size}>
                <LocaleIcon />
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Icons can be sized using wrapper elements with Tailwind size utilities.',
      },
    },
  },
};

export const BrandIcons: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {[
        MicrosoftIcon,
        ShopifyIcon,
        CirculyIcon,
        ProtelIcon,
        GmailIcon,
        OutlookIcon,
        OneDriveIcon,
      ].map((Icon, i) => (
        <div
          key={i}
          className="bg-muted flex size-16 items-center justify-center rounded-lg"
        >
          <div className="size-8">
            <Icon />
          </div>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Brand icons for third-party integrations.',
      },
    },
  },
};

export const UtilityIcons: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center justify-center gap-6">
      {[LocaleIcon, WebsiteIcon, EnterKeyIcon].map((Icon, i) => (
        <div
          key={i}
          className="bg-muted flex size-16 items-center justify-center rounded-lg"
        >
          <div className="size-6">
            <Icon />
          </div>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Utility icons for UI elements.',
      },
    },
  },
};
