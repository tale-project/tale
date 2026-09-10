import type { Meta, StoryObj } from '@storybook/react';
import { expect, fn, mocked } from 'storybook/test';

import { AbilityContext } from '@/app/context/ability-context';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { defineAbilityFor } from '@/lib/permissions/ability';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { FeatureFlagsEditor } from './feature-flags-editor';

const adminAbility = defineAbilityFor('admin');

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
  decorators: [
    (Story) => (
      <AbilityContext.Provider value={adminAbility}>
        <Story />
      </AbilityContext.Provider>
    ),
  ],
  beforeEach({ args }) {
    mocked(useGovernancePolicy, { partial: true }).mockReturnValue({
      data: {
        _id: 'storybook-feature-flags',
        _creationTime: 0,
        organizationId: args.organizationId,
        domain: 'governance',
        key: 'feature_flags',
        syncedAt: 0,
        config: { enabled: true, rules: [] },
      },
      isLoading: false,
    });
    mocked(useUpsertGovernancePolicy, { partial: true }).mockReturnValue({
      mutateAsync: fn().mockResolvedValue(null),
      isPending: false,
    });
    mocked(useMembers).mockReturnValue({ members: [], isLoading: false });
    mocked(useOrgTeams).mockReturnValue({ teams: [], isLoading: false });
  },
};

export default meta;
type Story = StoryObj<typeof FeatureFlagsEditor>;

export const Default: Story = {
  async play({ canvas, userEvent }) {
    const toggle = await canvas.findByRole('switch');
    await expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    await expect(toggle).not.toBeChecked();
  },
};

export const WithOrganization: Story = {
  args: {
    organizationId: 'org_demo',
  },
};
