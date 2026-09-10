import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import type { SandboxCapacity } from '@/app/lib/backend/contract/sandbox';

import { SandboxCapacitySection } from './sandbox-capacity';

const snapshot = {
  status: 'available',
  observedAt: Date.parse('2026-09-10T04:30:00Z'),
  backend: 'docker',
  scope: 'host',
  sessions: {
    running: 4,
    starting: 1,
    limit: 16,
    organizationRunning: 1,
    organizationStarting: 1,
    organizationLimit: 16,
  },
  resources: {
    cpu: { totalCores: 8, usedCores: 2.5 },
    memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 12 * 1024 ** 3 },
  },
  runtimeSessions: [],
} satisfies SandboxCapacity;

const meta: Meta<typeof SandboxCapacitySection> = {
  title: 'Settings/Sandboxes/Capacity',
  component: SandboxCapacitySection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
  args: {
    capacity: snapshot,
    isLoading: false,
    isRefreshing: false,
    onRefresh: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SandboxCapacitySection>;

export const HostMeasurements: Story = {};

export const HostMeasurementsDark: Story = {
  parameters: { themes: { themeOverride: 'dark' } },
};

export const Unavailable: Story = {
  args: { capacity: { status: 'unavailable', reason: 'unreachable' } },
};

export const FirstCpuSample: Story = {
  args: {
    capacity: {
      ...snapshot,
      resources: {
        ...snapshot.resources,
        cpu: { totalCores: 8, usedCores: null },
      },
    },
  },
};

export const Kubernetes: Story = {
  parameters: { themes: { themeOverride: 'dark' } },
  args: {
    capacity: {
      ...snapshot,
      backend: 'kubernetes',
      scope: 'namespace',
      resources: {
        cpu: { totalCores: null, usedCores: null },
        memory: { totalBytes: null, usedBytes: null },
      },
    },
  },
};

export const Loading: Story = {
  args: { capacity: undefined, isLoading: true, isRefreshing: true },
};
