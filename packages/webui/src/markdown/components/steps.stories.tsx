import type { Meta, StoryObj } from '@storybook/react';

import { Step, Steps } from './steps';

const meta = {
  title: 'webui/markdown/Steps',
  component: Steps,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Steps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const QuickStart: Story = {
  render: () => (
    <Steps>
      <Step title="Install the CLI">
        Run <code>brew install tale</code>.
      </Step>
      <Step title="Authenticate">
        Run <code>tale login</code> and follow the browser prompt.
      </Step>
      <Step title="Deploy">
        Run <code>tale deploy</code> from the project root.
      </Step>
    </Steps>
  ),
};
