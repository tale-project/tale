import type { Meta, StoryObj } from '@storybook/react';

import { ImagePlus, Upload } from 'lucide-react';
import { useState } from 'react';

import { FileUpload } from './file-upload';

const meta: Meta = {
  title: 'Forms/FileUpload',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A compound file upload component with drag-and-drop support.

## Usage
\`\`\`tsx
import { FileUpload } from '@/app/components/ui/forms/file-upload';

<FileUpload.Root>
  <FileUpload.DropZone onFilesSelected={handleFiles} accept="image/*">
    <p>Drag files here or click to upload</p>
  </FileUpload.DropZone>
  <FileUpload.Overlay />
</FileUpload.Root>
\`\`\`

## Compound components
- **FileUpload.Root** - Context provider for drag state, supports label/description/errorMessage
- **FileUpload.DropZone** - Drop target area with click-to-upload support
- **FileUpload.Overlay** - Visual overlay shown during drag-over

## Accessibility
- DropZone uses role="button" when clickable
- Keyboard accessible (Enter/Space to trigger file dialog)
- aria-disabled on disabled state
- aria-label support for screen readers
- Label, description, and error message on Root follow standard form field pattern
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: function Render() {
    const [files, setFiles] = useState<string[]>([]);

    return (
      <div className="w-96">
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={(selected) =>
              setFiles(selected.map((f) => f.name))
            }
            accept="image/*"
            aria-label="Upload images"
            className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
          >
            <ImagePlus className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              Drag and drop files here, or click to browse
            </p>
            <p className="text-muted-foreground text-xs">
              Supports: JPG, PNG, GIF
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1">
            {files.map((name) => (
              <li key={name} className="text-foreground text-sm">
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
};

export const MultipleFiles: Story = {
  render: function Render() {
    const [files, setFiles] = useState<string[]>([]);

    return (
      <div className="w-96">
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={(selected) =>
              setFiles((prev) => [...prev, ...selected.map((f) => f.name)])
            }
            multiple
            aria-label="Upload multiple files"
            className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
          >
            <Upload className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              Drop multiple files here
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <div className="mt-4">
            <p className="mb-1 text-sm font-medium">
              {files.length} file(s) selected:
            </p>
            <ul className="space-y-1">
              {files.map((name, i) => (
                <li
                  key={`${name}-${i}`}
                  className="text-muted-foreground text-sm"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Allows selecting multiple files at once.',
      },
    },
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="w-96">
      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          disabled
          aria-label="Upload disabled"
          className="border-muted-foreground/15 relative flex cursor-not-allowed flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 opacity-50"
        >
          <ImagePlus className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">Upload is disabled</p>
          <FileUpload.Overlay className="rounded-lg" />
        </FileUpload.DropZone>
      </FileUpload.Root>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Disabled state prevents clicking and drag-drop interactions.',
      },
    },
  },
};

export const NonClickable: Story = {
  render: () => (
    <div className="w-96">
      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          clickable={false}
          className="border-muted-foreground/25 relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8"
        >
          <Upload className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Drag and drop only (no click)
          </p>
          <FileUpload.Overlay className="rounded-lg" />
        </FileUpload.DropZone>
      </FileUpload.Root>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Drop zone that only accepts drag-and-drop, not click-to-browse.',
      },
    },
  },
};

export const CustomAccept: Story = {
  render: function Render() {
    const [files, setFiles] = useState<string[]>([]);

    return (
      <div className="w-96">
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={(selected) =>
              setFiles(selected.map((f) => f.name))
            }
            accept=".pdf,.doc,.docx"
            aria-label="Upload documents"
            className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
          >
            <Upload className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">Upload documents</p>
            <p className="text-muted-foreground text-xs">PDF, DOC, DOCX</p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1">
            {files.map((name) => (
              <li key={name} className="text-foreground text-sm">
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'DropZone configured to accept only document file types.',
      },
    },
  },
};

export const CustomOverlayLabel: Story = {
  render: () => (
    <div className="w-96">
      <FileUpload.Root>
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          aria-label="Upload files"
          className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
        >
          <ImagePlus className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Try dragging a file over this area
          </p>
          <FileUpload.Overlay
            className="rounded-lg"
            label="Release to upload your file"
          />
        </FileUpload.DropZone>
      </FileUpload.Root>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Overlay with a custom label displayed during drag-over.',
      },
    },
  },
};

export const WithLabel: Story = {
  render: function Render() {
    const [files, setFiles] = useState<string[]>([]);

    return (
      <div className="w-96">
        <FileUpload.Root label="Profile image">
          <FileUpload.DropZone
            onFilesSelected={(selected) =>
              setFiles(selected.map((f) => f.name))
            }
            accept="image/*"
            aria-label="Upload profile image"
            className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
          >
            <ImagePlus className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">
              Drag and drop or click to browse
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1">
            {files.map((name) => (
              <li key={name} className="text-foreground text-sm">
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'File upload with a label on the Root component.',
      },
    },
  },
};

export const WithDescription: Story = {
  render: () => (
    <div className="w-96">
      <FileUpload.Root
        label="Document upload"
        description="Upload PDF, DOC, or DOCX files up to 10MB"
      >
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          accept=".pdf,.doc,.docx"
          aria-label="Upload documents"
          className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
        >
          <Upload className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Drag and drop or click to browse
          </p>
          <FileUpload.Overlay className="rounded-lg" />
        </FileUpload.DropZone>
      </FileUpload.Root>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'File upload with label and description.',
      },
    },
  },
};

export const WithError: Story = {
  render: () => (
    <div className="w-96">
      <FileUpload.Root
        label="Invoice upload"
        errorMessage="Please upload a valid invoice file"
        required
      >
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          aria-label="Upload invoice"
          className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors"
        >
          <Upload className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            Drag and drop or click to browse
          </p>
          <FileUpload.Overlay className="rounded-lg" />
        </FileUpload.DropZone>
      </FileUpload.Root>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'File upload displaying an error message with required indicator.',
      },
    },
  },
};

export const WithCustomInputId: Story = {
  render: function Render() {
    const [files, setFiles] = useState<string[]>([]);

    return (
      <div className="w-96">
        <FileUpload.Root>
          <FileUpload.DropZone
            onFilesSelected={(selected) =>
              setFiles(selected.map((f) => f.name))
            }
            inputId="avatar-upload"
            accept="image/*"
            aria-label="Upload avatar"
            className="border-muted-foreground/25 hover:border-muted-foreground/50 relative flex size-32 cursor-pointer items-center justify-center rounded-full border-2 border-dashed transition-colors"
          >
            <ImagePlus className="text-muted-foreground size-6" />
            <FileUpload.Overlay className="rounded-full" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <p className="text-foreground mt-4 text-center text-sm">{files[0]}</p>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Circular upload zone for avatar-style uploads with a custom input ID.',
      },
    },
  },
};
