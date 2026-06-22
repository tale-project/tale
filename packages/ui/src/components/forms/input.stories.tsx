import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeletonize } from '../feedback/skeleton-context';
import { Input } from './input';

const meta: Meta<typeof Input> = {
  title: 'Forms/Input',
  component: Input,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'you@example.com' },
  render: (args) => (
    <div className="max-w-sm">
      <Input {...args} />
    </div>
  ),
};

export const WithValue: Story = {
  render: () => (
    <div className="max-w-sm">
      <Input defaultValue="Acme Inc." />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="max-w-sm">
      <Input placeholder="Disabled" disabled />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="max-w-sm">
      <Input defaultValue="not-an-email" aria-invalid aria-label="Email" />
    </div>
  ),
};

/** Inside a `<Skeletonize loading>` the field masks itself at its exact size. */
export const Loading: Story = {
  render: () => (
    <div className="max-w-sm">
      <Skeletonize loading>
        <Input placeholder="Loading" />
      </Skeletonize>
    </div>
  ),
};
