import type { Meta, StoryObj } from '@storybook/react';

import { Button } from '../primitives/button';
import { SkeletonBox, SkeletonCircle, SkeletonText } from './skeleton';
import { Skeletonize } from './skeleton-context';

const meta: Meta<typeof SkeletonBox> = {
  title: 'Feedback/Skeleton',
  component: SkeletonBox,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Loading placeholders with a pulse animation. They are **wrapping** primitives:
you wrap the REAL content and the skeleton sizes itself to that content — there
is no \`className\`/\`style\` and no sizing math at the call site.

- **\`SkeletonBox\`** — wrap any dynamic value/control:
  \`<SkeletonBox>{value}</SkeletonBox>\`. \`fullWidth\` makes it span its
  container.
- **\`SkeletonCircle\`** — round variant for avatars / status dots.
- **\`SkeletonText\`** — masked multi-line text shaped like real words; inherits
  the surrounding font metrics.
- **\`Skeletonize\`** — wrap a region of REAL component JSX; descendant
  skeleton-aware leaves (Input, Button, Badge, \`SkeletonBox\`) mask themselves
  while \`loading\`. Off, the wrappers are \`display: contents\` and add nothing.

## Accessibility
Skeleton primitives are \`aria-hidden\`; the enclosing \`Skeletonize\` announces
"Loading" once for the whole region.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SkeletonBox>;

export const WrappingValuesAndControls: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Skeletonize loading>
        <p className="text-sm">
          Balance: <SkeletonBox>$12,480.55</SkeletonBox>
        </p>
        <Button>Save changes</Button>
      </Skeletonize>
      <p className="text-fg-muted text-xs">
        Inside <code>Skeletonize loading</code> the value and button keep their
        real markup with a pulse overlay; flip <code>loading</code> off and the
        same tree shows the content.
      </p>
    </div>
  ),
};

export const Text: Story = {
  render: () => (
    <div className="w-80 space-y-6">
      <Skeletonize loading>
        <div className="text-sm">
          <SkeletonText />
        </div>
        <div className="text-sm leading-6">
          <SkeletonText lines={4} />
        </div>
      </Skeletonize>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Word-shaped multi-line text; the last line tapers like wrapped prose.',
      },
    },
  },
};

export const Card: Story = {
  render: () => (
    <Skeletonize loading>
      <div className="w-72 space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <SkeletonCircle>
            <span className="block size-10" />
          </SkeletonCircle>
          <div className="flex-1 space-y-2 text-sm">
            <SkeletonText />
            <SkeletonText />
          </div>
        </div>
        <div className="text-sm">
          <SkeletonText lines={3} />
        </div>
      </div>
    </Skeletonize>
  ),
};
