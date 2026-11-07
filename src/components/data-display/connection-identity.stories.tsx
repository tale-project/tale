import type { Meta, StoryObj } from '@storybook/react';
import { Bot, Terminal } from 'lucide-react';

import { ClaudeIcon } from '../../icons/claude-icon';
import { OpenAIIcon } from '../../icons/openai-icon';
import { TaleLogo } from '../../logo/tale-logo';
import { ConnectionIdentity } from './connection-identity';

const meta: Meta<typeof ConnectionIdentity> = {
  title: 'Data Display/ConnectionIdentity',
  component: ConnectionIdentity,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Two marks joined by a dashed line with a link glyph on it: who is asking to connect to what. The consent page for a coding agent opens with it; a vendor's sign-in for a connector can use it the same way.

## Usage
\`\`\`tsx
import { ConnectionIdentity } from '@tale/ui/connection-identity';

<ConnectionIdentity
  label="Claude Code connecting to Tale"
  from={<ClaudeIcon />}
  to={<TaleLogo wordmark={false} />}
/>
\`\`\`

## Accessibility
- One picture: \`role="img"\` named by \`label\`. A screen reader says the sentence and skips the marks
- The line draws once, over \`--duration-slow\`, and is simply there under \`prefers-reduced-motion: reduce\`
- Icons are shown at 24px inside the 40px tiles; the whole picture is 128px wide
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ConnectionIdentity>;

export const Default: Story = {
  args: {
    label: 'Claude Code connecting to Tale',
    from: <ClaudeIcon />,
    to: <TaleLogo wordmark={false} />,
  },
};

export const AnotherVendor: Story = {
  args: {
    label: 'Codex connecting to Tale',
    from: <OpenAIIcon />,
    to: <TaleLogo wordmark={false} />,
  },
};

export const UnknownApp: Story = {
  args: {
    label: 'An unverified app connecting to Tale',
    from: <Bot />,
    to: <TaleLogo wordmark={false} />,
  },
  parameters: {
    docs: {
      description: {
        story:
          'An app that cannot show a verified identity gets a neutral glyph, never an icon it chose for itself.',
      },
    },
  },
};

export const Letter: Story = {
  args: {
    label: 'Terminal connecting to Tale',
    from: <Terminal />,
    to: <span className="text-sm font-semibold">T</span>,
  },
};
