import type { Meta, StoryObj } from '@storybook/react';
import { useState, useCallback } from 'react';

import { ModelSelector } from './model-selector';
import type { SearchableSelectOption } from './searchable-select';

const ALL_MODELS = [
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
  { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
  { id: 'openai/gpt-4o', name: 'GPT-4o' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
];

const displayNameMap = new Map(ALL_MODELS.map((m) => [m.id, m.name]));

function getDisplayName(modelId: string): string {
  return displayNameMap.get(modelId) ?? modelId;
}

function ModelSelectorDemo({
  initialModels,
  readonlyOrder,
}: {
  initialModels: string[];
  readonlyOrder?: boolean;
}) {
  const [models, setModels] = useState(initialModels);

  const availableOptions: SearchableSelectOption[] = ALL_MODELS.filter(
    (m) => !models.includes(m.id),
  ).map((m) => ({ value: m.id, label: m.name }));

  const handleChange = useCallback((newModels: string[]) => {
    setModels(newModels);
  }, []);

  return (
    <ModelSelector
      models={models}
      onChange={handleChange}
      availableOptions={availableOptions}
      getDisplayName={getDisplayName}
      readonlyOrder={readonlyOrder}
    />
  );
}

const meta: Meta<typeof ModelSelector> = {
  title: 'Forms/ModelSelector',
  component: ModelSelector,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A reusable model selector with drag-to-reorder support and a searchable add dropdown.

## Usage
\`\`\`tsx
import { ModelSelector } from '@/app/components/ui/forms/model-selector';

<ModelSelector
  models={['anthropic/claude-sonnet-4', 'openai/gpt-4o']}
  onChange={setModels}
  availableOptions={options}
  getDisplayName={getDisplayName}
/>
\`\`\`

## Features
- Drag handle for pointer-based reordering
- Up/down arrow buttons for keyboard-accessible reordering
- Remove button per model (disabled at minimum)
- Searchable dropdown to add models
- First model = primary, rest = ordered fallbacks
        `,
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ModelSelector>;

export const Default: Story = {
  render: () => (
    <ModelSelectorDemo
      initialModels={[
        'anthropic/claude-sonnet-4',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ]}
    />
  ),
};

export const SingleModel: Story = {
  render: () => (
    <ModelSelectorDemo initialModels={['anthropic/claude-sonnet-4']} />
  ),
};

export const ManyModels: Story = {
  render: () => (
    <ModelSelectorDemo
      initialModels={[
        'anthropic/claude-sonnet-4',
        'anthropic/claude-opus-4',
        'openai/gpt-4o',
        'openai/gpt-4o-mini',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash',
      ]}
    />
  ),
};

export const ReadonlyOrder: Story = {
  render: () => (
    <ModelSelectorDemo
      initialModels={[
        'anthropic/claude-sonnet-4',
        'openai/gpt-4o',
        'google/gemini-2.5-pro',
      ]}
      readonlyOrder
    />
  ),
};
