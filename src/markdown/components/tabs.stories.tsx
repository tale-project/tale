import type { Meta, StoryObj } from '@storybook/react';

import { Tab, Tabs } from './tabs';

const meta = {
  title: 'markdown/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Tabbed content following the WAI-ARIA tab pattern: arrow keys move focus between tabs, Home/End jump to first/last, and Tab moves focus into the active panel. Only the active tab is in the tab order (roving tabindex).',
      },
    },
  },
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

export const TwoTabs: Story = {
  render: () => (
    <Tabs>
      <Tab title="Overview">
        <p>High-level summary of the feature.</p>
      </Tab>
      <Tab title="Details">
        <p>In-depth implementation notes and edge cases.</p>
      </Tab>
    </Tabs>
  ),
};
