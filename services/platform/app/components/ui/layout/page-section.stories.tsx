import type { Meta, StoryObj } from '@storybook/react';

import { Input } from '../forms/input';
import { Select } from '../forms/select';
import { Switch } from '../forms/switch';
import { Button } from '../primitives/button';
import { Stack } from './layout';
import { PageSection } from './page-section';

const meta: Meta<typeof PageSection> = {
  title: 'Layout/PageSection',
  component: PageSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
A semantic section wrapper combining a SectionHeader with content.

## Usage
\`\`\`tsx
import { PageSection } from '@/app/components/ui/layout/page-section';

<PageSection title="Model Settings" description="Choose the AI model for this agent.">
  <Select options={modelOptions} label="Model" />
</PageSection>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof PageSection>;

export const Default: Story = {
  render: () => (
    <PageSection
      title="Model Settings"
      description="Choose the AI model preset for this agent."
    >
      <Select
        options={[
          { value: 'fast', label: 'Fast' },
          { value: 'standard', label: 'Standard' },
          { value: 'advanced', label: 'Advanced' },
        ]}
        label="Model Preset"
        value="standard"
      />
    </PageSection>
  ),
};

export const WithFormFields: Story = {
  render: () => (
    <PageSection
      title="General"
      description="Configure the basic settings for this agent."
    >
      <Stack gap={3}>
        <Input label="Name" placeholder="Enter agent name" />
        <Input label="Display Name" placeholder="Enter display name" />
      </Stack>
    </PageSection>
  ),
};

export const WithAction: Story = {
  render: () => (
    <PageSection
      title="Members"
      description="Manage team members and their access permissions."
      action={<Button size="sm">Add Member</Button>}
    >
      <div className="bg-muted/30 flex h-32 items-center justify-center rounded-lg border border-dashed">
        Member table placeholder
      </div>
    </PageSection>
  ),
};

export const WithToggle: Story = {
  render: () => (
    <PageSection
      title="File Preprocessing"
      description="Automatically preprocess uploaded files before sending to the AI."
    >
      <Switch label="Enable file preprocessing" />
    </PageSection>
  ),
};

export const CustomGap: Story = {
  render: () => (
    <Stack gap={8}>
      <PageSection
        title="Section with gap 3"
        description="Tighter spacing."
        gap={3}
      >
        <div className="bg-muted/30 h-16 rounded-lg border border-dashed" />
      </PageSection>
      <PageSection
        title="Section with gap 6"
        description="Wider spacing."
        gap={6}
      >
        <div className="bg-muted/30 h-16 rounded-lg border border-dashed" />
      </PageSection>
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Gap between header and content can be adjusted.',
      },
    },
  },
};

export const NestedSections: Story = {
  render: () => (
    <Stack gap={8} className="max-w-lg">
      <PageSection
        title="Instructions"
        description="Define the system instructions for this agent."
      >
        <Input label="System Instructions" placeholder="You are a..." />
      </PageSection>
      <PageSection
        title="Model"
        description="Choose the AI model for this agent."
      >
        <Select
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'standard', label: 'Standard' },
          ]}
          label="Model Preset"
          value="fast"
        />
      </PageSection>
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Multiple sections stacked together with consistent layout.',
      },
    },
  },
};
