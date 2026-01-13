import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { FileUpload } from './file-upload';

const meta: Meta<typeof FileUpload> = {
  title: 'Forms/FileUpload',
  component: FileUpload,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A file upload component with button trigger and filename display.

## Usage
\`\`\`tsx
import { FileUpload } from '@/components/ui/forms/file-upload';

<FileUpload
  label="Upload document"
  accept=".pdf,.doc,.docx"
  onChange={(file) => console.log(file)}
/>
\`\`\`

## Accessibility
- Label is associated with the hidden file input
- Button is keyboard accessible
- File name is announced when selected
        `,
      },
    },
  },
  argTypes: {
    accept: {
      control: 'text',
      description: 'Accepted file types (e.g., ".pdf,.jpg")',
    },
    label: {
      control: 'text',
      description: 'Label text above the upload button',
    },
    buttonText: {
      control: 'text',
      description: 'Text displayed on the upload button',
    },
    required: {
      control: 'boolean',
      description: 'Whether the field is required',
    },
  },
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof FileUpload>;

export const Default: Story = {
  args: {
    onChange: fn(),
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Upload document',
    onChange: fn(),
  },
};

export const Required: Story = {
  args: {
    label: 'Profile picture',
    required: true,
    onChange: fn(),
  },
};

export const CustomButtonText: Story = {
  args: {
    label: 'Attachment',
    buttonText: 'Choose file',
    onChange: fn(),
  },
};

export const AcceptImages: Story = {
  args: {
    label: 'Upload image',
    accept: 'image/*',
    buttonText: 'Select image',
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Accept only image files.',
      },
    },
  },
};

export const AcceptPDF: Story = {
  args: {
    label: 'Upload PDF',
    accept: '.pdf',
    buttonText: 'Select PDF',
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Accept only PDF files.',
      },
    },
  },
};

export const AcceptMultipleTypes: Story = {
  args: {
    label: 'Upload document',
    accept: '.pdf,.doc,.docx,.xls,.xlsx',
    buttonText: 'Select document',
    onChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        story: 'Accept multiple document types.',
      },
    },
  },
};
