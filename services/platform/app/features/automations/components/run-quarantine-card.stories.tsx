import type { Meta, StoryObj } from '@storybook/react';
import { fn, mocked } from 'storybook/test';

import { useRequestLegacyRunStop } from '../hooks/mutations';
import { RunQuarantineCard } from './run-quarantine-card';

const quarantine = {
  reason: 'legacy_execution_unproven' as const,
  observedAt: 1791400000000,
  claimEpoch: 4,
  priorStatus: 'running' as const,
  resolution: null,
};

const meta: Meta<typeof RunQuarantineCard> = {
  title: 'Automations/RunQuarantineCard',
  component: RunQuarantineCard,
  parameters: { layout: 'padded' },
  args: {
    organizationId: 'org_test',
    runId: 'run_test',
    quarantine,
    onReload: fn(),
  },
  beforeEach() {
    mocked(useRequestLegacyRunStop, { partial: true }).mockReturnValue({
      isPending: false,
      mutateAsync: fn().mockResolvedValue({
        requested: true,
        status: 'quarantined',
        legacyQuarantine: {
          ...quarantine,
          resolution: {
            action: 'stop',
            actor: 'user:reviewer',
            at: 1791400001000,
          },
        },
      }),
    });
  },
};
export default meta;
type Story = StoryObj<typeof RunQuarantineCard>;

export const OnHold: Story = {};
export const StopRequested: Story = {
  args: {
    quarantine: {
      ...quarantine,
      resolution: { action: 'stop', actor: 'user:reviewer', at: 1791400001000 },
    },
  },
};
export const MissingDetails: Story = { args: { quarantine: undefined } };
export const ReadOnly: Story = { args: { canRequestStop: false } };
