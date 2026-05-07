import type { Meta, StoryObj } from '@storybook/react';

import { Tab, Tabs } from './tabs';

const meta = {
  title: 'webui/markdown/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreePlatforms: Story = {
  render: () => (
    <Tabs>
      <Tab title="macOS">
        <p>
          Run <code>brew install tale</code> to install the CLI.
        </p>
      </Tab>
      <Tab title="Linux">
        <p>
          Use the install script:{' '}
          <code>curl https://tale.dev/install.sh | sh</code>.
        </p>
      </Tab>
      <Tab title="Windows">
        <p>
          Download the latest release from{' '}
          <a href="https://github.com/tale-project/tale/releases">GitHub</a>.
        </p>
      </Tab>
    </Tabs>
  ),
};
