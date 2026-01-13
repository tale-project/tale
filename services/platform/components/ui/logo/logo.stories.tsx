import type { Meta, StoryObj } from '@storybook/react';
import { TaleLogo } from './tale-logo';
import { TaleLogoText } from './tale-logo-text';

const meta: Meta<typeof TaleLogo> = {
  title: 'Brand/Logo',
  component: TaleLogo,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Tale brand logo components with automatic dark/light mode support.

## Usage
\`\`\`tsx
import { TaleLogo } from '@/components/ui/logo/tale-logo';
import { TaleLogoText } from '@/components/ui/logo/tale-logo-text';

<TaleLogo />
<TaleLogoText />
\`\`\`

## Features
- Automatic dark/light mode switching
- SVG-based for crisp rendering at any size
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TaleLogo>;

export const IconLogo: Story = {
  render: () => <TaleLogo />,
  name: 'Icon Logo',
};

export const TextLogo: Story = {
  render: () => <TaleLogoText />,
  name: 'Text Logo',
};

export const Combined: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <TaleLogo />
      <TaleLogoText />
    </div>
  ),
  name: 'Combined Logo',
};

export const InNavigation: Story = {
  render: () => (
    <nav className="flex items-center justify-between p-4 border rounded-lg w-96">
      <div className="flex items-center gap-2">
        <TaleLogo />
        <TaleLogoText />
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">Dashboard</span>
        <span className="text-muted-foreground">Settings</span>
      </div>
    </nav>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Logo used in a navigation bar context.',
      },
    },
  },
};

export const LogoOnly: Story = {
  render: () => (
    <div className="flex items-center justify-center p-8 border rounded-lg">
      <TaleLogo />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Icon logo for compact spaces like favicons or mobile headers.',
      },
    },
  },
};

export const OnDarkBackground: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-6 bg-gray-900 rounded-lg dark">
      <TaleLogo />
      <TaleLogoText />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Logo automatically switches to light version on dark backgrounds.',
      },
    },
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <div className="scale-75">
        <TaleLogo />
      </div>
      <TaleLogo />
      <div className="scale-125">
        <TaleLogo />
      </div>
      <div className="scale-150">
        <TaleLogo />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Logo at different scales (scaled via CSS transform).',
      },
    },
  },
};
