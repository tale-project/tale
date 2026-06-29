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
    organizationId: 'org_demo',
    onUpload: fn(),
    onRemove: fn(),
    imageType: 'logo',
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

export const WithImage: Story = {
  args: {
    currentUrl:
      'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%228%22%20fill%3D%22%236366f1%22/%3E%3C/svg%3E',
    ariaLabel: 'Upload logo',
  },
  parameters: {
    docs: {
      description: {
        story:
          'With an uploaded image. Hover or focus the control to reveal the replace overlay; a remove button sits in the corner.',
      },
    },
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
        organizationId="org_demo"
        imageType="favicon-light"
        onUpload={fn()}
        onRemove={fn()}
        label="Light"
        ariaLabel="Upload favicon (light)"
      />
      <ImageUploadField
        organizationId="org_demo"
        imageType="favicon-dark"
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
