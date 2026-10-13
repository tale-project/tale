import type { Meta, StoryObj } from '@storybook/react-vite';

import { BorderedSection } from './bordered-section';

const meta: Meta<typeof BorderedSection> = {
  title: 'Layout/BorderedSection',
  component: BorderedSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof BorderedSection>;

export const Default: Story = {
  args: {
    children: (
      <p className="text-muted-foreground text-sm">
        Section content sits inside a bordered, rounded surface.
      </p>
    ),
  },
};

export const WithHeading: Story = {
  args: {
    children: (
      <>
        <h3 className="text-foreground text-base font-semibold">
          Section title
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Mix in any content the layout requires.
        </p>
      </>
    ),
  },
};
