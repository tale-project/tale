import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeletonize } from '../feedback/skeleton-context';
import { Checkbox } from './checkbox';
import { Label } from './label';

const meta: Meta<typeof Checkbox> = {
  title: 'Forms/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Checkbox>;

export const Unchecked: Story = {
  render: () => <Checkbox aria-label="Accept terms" />,
};

export const Checked: Story = {
  render: () => <Checkbox defaultChecked aria-label="Accept terms" />,
};

export const Indeterminate: Story = {
  render: () => <Checkbox checked="indeterminate" aria-label="Select all" />,
};

export const Disabled: Story = {
  render: () => <Checkbox disabled aria-label="Disabled" />,
};

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="terms" />
      <Label htmlFor="terms">Accept terms and conditions</Label>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <Skeletonize loading>
      <Checkbox aria-label="Loading" />
    </Skeletonize>
  ),
};
