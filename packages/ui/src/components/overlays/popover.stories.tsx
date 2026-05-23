import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../primitives/button';
import { Popover } from './popover';

const meta: Meta<typeof Popover> = {
  title: 'Overlays/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  args: { contentClassName: 'w-72' },
  render: (args) => (
    <Popover
      {...args}
      trigger={<Button variant="secondary">Open popover</Button>}
    >
      <div className="grid gap-2">
        <h4 className="leading-none font-medium">Quick action</h4>
        <p className="text-muted-foreground text-sm">
          Any rich content can live inside the popover surface.
        </p>
      </div>
    </Popover>
  ),
};

export const AlignStart: Story = {
  args: { align: 'start' },
  render: (args) => (
    <Popover
      {...args}
      trigger={<Button variant="secondary">Align start</Button>}
    >
      <p className="text-sm">This popover is aligned to the start.</p>
    </Popover>
  ),
};

export const AlignEnd: Story = {
  args: { align: 'end' },
  render: (args) => (
    <Popover {...args} trigger={<Button variant="secondary">Align end</Button>}>
      <p className="text-sm">This popover is aligned to the end.</p>
    </Popover>
  ),
};
