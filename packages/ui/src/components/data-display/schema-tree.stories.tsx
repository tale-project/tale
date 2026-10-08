import type { Meta, StoryObj } from '@storybook/react-vite';

import { SchemaTree, type SchemaTreeSchema } from './schema-tree';

const meta: Meta<typeof SchemaTree> = {
  title: 'DataDisplay/SchemaTree',
  component: SchemaTree,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The fields of a value as a form reads them: name, kind in words, required, tags. See the guide on ui.tale.dev.',
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof SchemaTree>;

const INPUT: SchemaTreeSchema = {
  type: 'object',
  required: ['owner', 'repo'],
  properties: {
    owner: {
      type: 'string',
      description: 'The account that owns the repository.',
    },
    repo: { type: 'string' },
    limit: { type: 'integer' },
    state: { enum: ['open', 'closed'] },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, score: { type: 'number' } },
      },
    },
  },
};

export const Compact: Story = {
  args: { schema: INPUT, density: 'compact', maxRows: 3 },
};

export const Comfortable: Story = {
  args: {
    schema: INPUT,
    tagOf: (path) => (path[0] === 'owner' ? 'from the trigger' : undefined),
    maybeEmpty: (path) => path[0] === 'issues',
    typeScript: '{ owner: string; repo: string; limit?: number }',
  },
};

export const NoFields: Story = {
  args: { schema: { type: 'array', items: { type: 'number' } } },
};
