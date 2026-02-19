import type { Meta, StoryObj } from '@storybook/react';

import { fn } from 'storybook/test';

import { ImageUploadField } from './image-upload-field';

const meta: Meta<typeof ImageUploadField> = {
  title: 'Settings/Branding/ImageUploadField',
  component: ImageUploadField,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md'],
      description: 'Size variant of the upload field',
    },
    label: {
      control: 'text',
      description: 'Label text displayed below the upload field',
    },
    currentUrl: {
      control: 'text',
      description: 'URL of the currently uploaded image',
    },
  },
  args: {
    onUpload: fn(),
    onRemove: fn(),
    ariaLabel: 'Upload image',
  },
};

export default meta;
type Story = StoryObj<typeof ImageUploadField>;

export const Empty: Story = {
  args: {
    ariaLabel: 'Upload logo',
  },
};

export const EmptyWithLabel: Story = {
  args: {
    label: 'Light',
    ariaLabel: 'Upload favicon (light)',
  },
};

export const SmallSize: Story = {
  args: {
    size: 'sm',
    ariaLabel: 'Upload favicon',
  },
};

export const MediumSize: Story = {
  args: {
    size: 'md',
    ariaLabel: 'Upload logo',
  },
};

export const FaviconPair: Story = {
  render: () => (
    <div className="flex gap-2">
      <ImageUploadField
        onUpload={fn()}
        onRemove={fn()}
        label="Light"
        ariaLabel="Upload favicon (light)"
      />
      <ImageUploadField
        onUpload={fn()}
        onRemove={fn()}
        label="Dark"
        ariaLabel="Upload favicon (dark)"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Favicon upload fields as they appear in the branding form (light and dark variants).',
      },
    },
  },
};
