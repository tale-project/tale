import type { Meta, StoryObj } from '@storybook/react';

import { CanvasCodeRenderer } from './canvas-code-renderer';

const SAMPLE_JS = `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

console.log(fibonacci(10));`;

const SAMPLE_PYTHON = `def fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(10))`;

const meta: Meta<typeof CanvasCodeRenderer> = {
  title: 'Features/Canvas/CanvasCodeRenderer',
  component: CanvasCodeRenderer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    isEditing: { control: 'boolean' },
    language: {
      control: 'select',
      options: ['javascript', 'python', 'rust', 'go', 'json', 'plaintext'],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ height: 400 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof CanvasCodeRenderer>;

export const PreviewJavaScript: Story = {
  args: {
    code: SAMPLE_JS,
    language: 'javascript',
    isEditing: false,
    onContentChange: () => {},
  },
};

export const EditJavaScript: Story = {
  args: {
    code: SAMPLE_JS,
    language: 'javascript',
    isEditing: true,
    onContentChange: () => {},
  },
};

export const PreviewPython: Story = {
  args: {
    code: SAMPLE_PYTHON,
    language: 'python',
    isEditing: false,
    onContentChange: () => {},
  },
};

export const EmptyContent: Story = {
  args: {
    code: '',
    language: 'javascript',
    isEditing: false,
    onContentChange: () => {},
  },
};

export const LongContent: Story = {
  args: {
    code: Array.from(
      { length: 200 },
      (_, i) => `const line${i + 1} = ${i + 1};`,
    ).join('\n'),
    language: 'javascript',
    isEditing: false,
    onContentChange: () => {},
  },
};
