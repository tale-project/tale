import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
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
- **FileUpload.Root** - Context provider for drag state
- **FileUpload.DropZone** - Drop target area with click-to-upload support
- **FileUpload.Overlay** - Visual overlay shown during drag-over

## Accessibility
- DropZone uses role="button" when clickable
- Keyboard accessible (Enter/Space to trigger file dialog)
- aria-disabled on disabled state
- aria-label support for screen readers
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
            className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 hover:border-muted-foreground/50 transition-colors cursor-pointer"
          >
            <ImagePlus className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag and drop files here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supports: JPG, PNG, GIF
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1">
            {files.map((name) => (
              <li key={name} className="text-sm text-foreground">
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
            className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 hover:border-muted-foreground/50 transition-colors cursor-pointer"
          >
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drop multiple files here
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium mb-1">{files.length} file(s) selected:</p>
            <ul className="space-y-1">
              {files.map((name, i) => (
                <li key={`${name}-${i}`} className="text-sm text-muted-foreground">
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
          className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/15 p-8 opacity-50 cursor-not-allowed"
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Upload is disabled
          </p>
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
          className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8"
        >
          <Upload className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
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
        story: 'Drop zone that only accepts drag-and-drop, not click-to-browse.',
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
            className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 hover:border-muted-foreground/50 transition-colors cursor-pointer"
          >
            <Upload className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Upload documents
            </p>
            <p className="text-xs text-muted-foreground">
              PDF, DOC, DOCX
            </p>
            <FileUpload.Overlay className="rounded-lg" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <ul className="mt-4 space-y-1">
            {files.map((name) => (
              <li key={name} className="text-sm text-foreground">
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
          className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 hover:border-muted-foreground/50 transition-colors cursor-pointer"
        >
          <ImagePlus className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Try dragging a file over this area
          </p>
          <FileUpload.Overlay className="rounded-lg" label="Release to upload your file" />
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
            className="relative flex items-center justify-center size-32 rounded-full border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors cursor-pointer"
          >
            <ImagePlus className="size-6 text-muted-foreground" />
            <FileUpload.Overlay className="rounded-full" />
          </FileUpload.DropZone>
        </FileUpload.Root>
        {files.length > 0 && (
          <p className="mt-4 text-sm text-center text-foreground">{files[0]}</p>
        )}
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Circular upload zone for avatar-style uploads with a custom input ID.',
      },
    },
  },
};
