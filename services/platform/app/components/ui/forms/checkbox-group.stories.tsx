import type { Meta, StoryObj } from '@storybook/react';

import { useState } from 'react';

import { Checkbox } from './checkbox';
import { CheckboxGroup } from './checkbox-group';

const meta: Meta<typeof CheckboxGroup> = {
  title: 'Forms/CheckboxGroup',
  component: CheckboxGroup,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A checkbox group component for selecting multiple options from a set.

## Usage

### Simple (options prop)
\`\`\`tsx
import { CheckboxGroup } from '@/app/components/ui/forms/checkbox-group';

<CheckboxGroup
  label="Permissions"
  value={selected}
  onValueChange={setSelected}
  options={[
    { value: 'read', label: 'Read' },
    { value: 'write', label: 'Write' },
    { value: 'admin', label: 'Admin' },
  ]}
/>
\`\`\`

### Custom layout (children)
\`\`\`tsx
<CheckboxGroup label="Features">
  <Checkbox label="Dark mode" />
  <Checkbox label="Notifications" />
</CheckboxGroup>
\`\`\`

## Accessibility
- \`role="group"\` with \`aria-labelledby\` and \`aria-describedby\`
- Full keyboard navigation
- Labels associated with inputs
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CheckboxGroup>;

function DefaultRender() {
  const [value, setValue] = useState<string[]>(['read']);
  return (
    <CheckboxGroup
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'read', label: 'Read' },
        { value: 'write', label: 'Write' },
        { value: 'admin', label: 'Admin' },
      ]}
    />
  );
}

export const Default: Story = {
  render: () => <DefaultRender />,
};

function WithLabelRender() {
  const [value, setValue] = useState<string[]>([]);
  return (
    <CheckboxGroup
      label="Permissions"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'read', label: 'Read access' },
        { value: 'write', label: 'Write access' },
        { value: 'admin', label: 'Admin access' },
      ]}
    />
  );
}

export const WithLabel: Story = {
  render: () => <WithLabelRender />,
};

function WithDescriptionRender() {
  const [value, setValue] = useState<string[]>(['email']);
  return (
    <CheckboxGroup
      label="Notifications"
      description="Select how you want to be notified."
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'SMS' },
        { value: 'push', label: 'Push notifications' },
      ]}
    />
  );
}

export const WithDescription: Story = {
  render: () => <WithDescriptionRender />,
};

function WithOptionDescriptionsRender() {
  const [value, setValue] = useState<string[]>(['web']);
  return (
    <CheckboxGroup
      label="Tools"
      description="Select which tools this agent can use."
      value={value}
      onValueChange={setValue}
      options={[
        {
          value: 'web',
          label: 'Web search',
          description: 'Search the web for real-time information',
        },
        {
          value: 'rag',
          label: 'Knowledge base',
          description: 'Search internal documents and knowledge',
        },
        {
          value: 'calc',
          label: 'Calculator',
          description: 'Perform mathematical calculations',
        },
      ]}
    />
  );
}

export const WithOptionDescriptions: Story = {
  render: () => <WithOptionDescriptionsRender />,
};

function WithDisabledOptionRender() {
  const [value, setValue] = useState<string[]>(['free']);
  return (
    <CheckboxGroup
      label="Features"
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'free', label: 'Free tier' },
        { value: 'pro', label: 'Pro features' },
        { value: 'enterprise', label: 'Enterprise', disabled: true },
      ]}
    />
  );
}

export const WithDisabledOption: Story = {
  render: () => <WithDisabledOptionRender />,
};

export const Disabled: Story = {
  args: {
    label: 'Permissions',
    disabled: true,
    value: ['read'],
    options: [
      { value: 'read', label: 'Read' },
      { value: 'write', label: 'Write' },
      { value: 'admin', label: 'Admin' },
    ],
  },
};

function SingleColumnRender() {
  const [value, setValue] = useState<string[]>(['read']);
  return (
    <CheckboxGroup
      label="Permissions"
      columns={1}
      value={value}
      onValueChange={setValue}
      options={[
        { value: 'read', label: 'Read' },
        { value: 'write', label: 'Write' },
        { value: 'admin', label: 'Admin' },
      ]}
    />
  );
}

export const SingleColumn: Story = {
  render: () => <SingleColumnRender />,
};

export const WithChildren: Story = {
  render: () => (
    <CheckboxGroup label="Features">
      <Checkbox label="Dark mode" />
      <Checkbox label="Notifications" />
      <Checkbox label="Auto-save" />
    </CheckboxGroup>
  ),
};
