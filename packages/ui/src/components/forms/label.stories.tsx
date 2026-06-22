import type { Meta, StoryObj } from '@storybook/react-vite';

import { Input } from './input';
import { Label } from './label';

const meta: Meta<typeof Label> = {
  title: 'Forms/Label',
  component: Label,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Label>;

export const Default: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor="name">Name</Label>
      <Input id="name" placeholder="Acme Inc." />
    </div>
  ),
};

/** A label associates with its control via `htmlFor`, so clicking it focuses the input. */
export const WithRequiredMarker: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-2">
      <Label htmlFor="email">
        Email
        <span className="ml-0.5 text-[color:var(--color-danger)]" aria-hidden>
          *
        </span>
      </Label>
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};
