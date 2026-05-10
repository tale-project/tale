import type { Meta, StoryObj } from '@storybook/react';

import { Step, Steps } from './steps';

const meta = {
  title: 'markdown/Steps',
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

export const RichContent: Story = {
  render: () => (
    <Steps>
      <Step title="Multi-line description with paragraphs">
        <p>
          This first paragraph explains the high-level idea so readers can
          orient themselves before diving into the specific commands shown
          below. It is intentionally long to verify wrap behaviour.
        </p>
        <p>
          A second paragraph confirms vertical spacing between block-level
          children inside a step body.
        </p>
      </Step>
      <Step title="Embedded code block">
        <p>
          Use the following snippet to bootstrap a new project from a template:
        </p>
        <pre>
          <code>{`tale init my-app
cd my-app
tale dev`}</code>
        </pre>
        <p>
          See the{' '}
          <a href="https://docs.tale.dev" rel="noreferrer">
            documentation
          </a>{' '}
          for more options.
        </p>
      </Step>
      <Step title="No-title step works too">
        <p>This step has a title; the next one does not.</p>
      </Step>
      <Step>
        Plain inline content with a <a href="#anchor">link</a> and{' '}
        <code>inline code</code>, no title.
      </Step>
    </Steps>
  ),
};

export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <Steps>
        <Step title="Narrow viewport">
          Verifies that the numbered bullet stays inside the container at mobile
          widths and the connector line aligns with the bullet centre.
        </Step>
        <Step title="Second step">
          Confirms the connector reaches both bullets without overflow.
        </Step>
      </Steps>
    </div>
  ),
};
