import type { Meta, StoryObj } from '@storybook/react';

import { Checkbox } from './checkbox';
import { FormSection } from './form-section';
import { Input } from './input';
import { Switch } from './switch';

const meta: Meta<typeof FormSection> = {
  title: 'Forms/FormSection',
  component: FormSection,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A section-level label and description component for grouping form controls.

Use this when you need to label a group of related inputs rather than a single form control.

## Usage
\`\`\`tsx
import { FormSection } from '@/app/components/ui/forms/form-section';

<FormSection
  label="Notification preferences"
  description="Configure how you receive notifications."
>
  <Switch label="Email" />
  <Switch label="SMS" />
</FormSection>
\`\`\`
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FormSection>;

export const Default: Story = {
  args: {
    label: 'Notification preferences',
    description: 'Configure how you receive notifications.',
  },
  render: (args) => (
    <FormSection {...args}>
      <div className="flex flex-col gap-3">
        <Switch label="Email notifications" />
        <Switch label="SMS notifications" />
        <Switch label="Push notifications" />
      </div>
    </FormSection>
  ),
};

export const LabelOnly: Story = {
  args: {
    label: 'Account settings',
  },
  render: (args) => (
    <FormSection {...args}>
      <div className="flex flex-col gap-3">
        <Input label="Display name" placeholder="Enter name" />
        <Input label="Email" type="email" placeholder="Enter email" />
      </div>
    </FormSection>
  ),
};

export const DescriptionOnly: Story = {
  args: {
    description:
      'Your data is syncing automatically. Changes may take a few minutes to appear.',
  },
};

export const WithCheckboxGroup: Story = {
  render: () => (
    <FormSection
      label="Permissions"
      description="Select the permissions for this role."
    >
      <div className="flex flex-col gap-2">
        <Checkbox label="Read access" />
        <Checkbox label="Write access" />
        <Checkbox label="Admin access" />
      </div>
    </FormSection>
  ),
};
