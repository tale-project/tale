import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeletonize } from '../feedback/skeleton-context';
import { Textarea } from './textarea';

const meta: Meta<typeof Textarea> = {
  title: 'Forms/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { placeholder: 'Write a description…' },
  render: (args) => (
    <div className="max-w-sm">
      <Textarea {...args} />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className="max-w-sm">
      <Textarea placeholder="Disabled" disabled />
    </div>
  ),
};

export const Invalid: Story = {
  render: () => (
    <div className="max-w-sm">
      <Textarea defaultValue="Too short" aria-invalid aria-label="Notes" />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="max-w-sm">
      <Skeletonize loading>
        <Textarea rows={4} />
      </Skeletonize>
    </div>
  ),
};
