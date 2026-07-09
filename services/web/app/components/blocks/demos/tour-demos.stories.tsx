import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from '@tale/ui/app-shell';

import { i18n } from '@/lib/i18n/i18n';

import { AutomationRun } from './automation-run';
import { ConnectAgents } from './connect-agents';
import { GovernGate } from './govern-gate';
import { KnowledgePool } from './knowledge-pool';

const meta = {
  title: 'Blocks/Demos/TourDemos',
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
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connect: Story = { render: () => <ConnectAgents /> };
export const Knowledge: Story = { render: () => <KnowledgePool /> };
export const Automation: Story = { render: () => <AutomationRun /> };
export const Govern: Story = { render: () => <GovernGate /> };
