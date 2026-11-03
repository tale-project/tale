import type { Meta, StoryObj } from '@storybook/react';
import { Bell, House } from 'lucide-react';

import { CountBadge } from './count-badge';

const meta: Meta<typeof CountBadge> = {
  title: 'Feedback/CountBadge',
  component: CountBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The count chip on a navigation glyph (rail tile, notification bell, tab bar).

## Usage
\`\`\`tsx
import { CountBadge } from '@tale/ui/count-badge';

<span className="relative inline-flex">
  <Bell className="size-5" aria-hidden />
  <CountBadge count={3} className="absolute -top-1.5 -right-1.5" />
</span>
\`\`\`

## Accessibility
- The chip is \`aria-hidden\`: put the count's meaning in the control's own
  accessible name ("Notifications, 3 unread")
- Renders nothing at zero; counts above 99 read "99+"
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof CountBadge>;

export const OnGlyphs: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      {[1, 12, 140].map((count) => (
        <span key={count} className="relative inline-flex">
          <House className="size-5" aria-hidden />
          <CountBadge count={count} className="absolute -top-1.5 -right-1.5" />
        </span>
      ))}
      <span className="relative inline-flex">
        <Bell className="size-5" aria-hidden />
        <CountBadge count={4} className="absolute -top-1.5 -right-1.5" />
      </span>
    </div>
  ),
};
