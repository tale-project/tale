import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../primitives/button';
import { PageSection } from './page-section';

const meta: Meta<typeof PageSection> = {
  title: 'Layout/PageSection',
  component: PageSection,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof PageSection>;

export const Default: Story = {
  args: {
    title: 'Section title',
    description: 'A brief description of what this section is about.',
    children: (
      <p className="text-muted-foreground text-sm">Section body content.</p>
    ),
  },
};

export const WithAction: Story = {
  args: {
    title: 'Members',
    description: 'People who can access this workspace.',
    action: <Button size="sm">Invite</Button>,
    children: <p className="text-muted-foreground text-sm">No members yet.</p>,
  },
};
