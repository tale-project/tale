import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { HeroOrchestration } from './hero-orchestration';

const meta = {
  title: 'Blocks/Demos/HeroOrchestration',
  component: HeroOrchestration,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <AppShell i18n={i18n}>
        <div className="mx-auto w-full max-w-4xl">
          <Story />
        </div>
      </AppShell>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof HeroOrchestration>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PlaysOnMount: Story = {};
