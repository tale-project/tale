import type { Meta, StoryObj } from '@storybook/react';

import { FeatureFlagsEditor } from './feature-flags-editor';

const meta: Meta<typeof FeatureFlagsEditor> = {
  title: 'Settings/Governance/FeatureFlagsEditor',
  component: FeatureFlagsEditor,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
  },
  args: {
    organizationId: 'org_test',
  },
};

export default meta;
type Story = StoryObj<typeof FeatureFlagsEditor>;

export const Default: Story = {};

export const WithOrganization: Story = {
  args: {
    organizationId: 'org_demo',
  },
};
