import type { Meta, StoryObj } from '@storybook/react';

import { DocumentIcon } from './document-icon';

const meta: Meta<typeof DocumentIcon> = {
  title: 'Data Display/DocumentIcon',
  component: DocumentIcon,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A document icon component that displays file type icons using Microsoft Graph Toolkit.

## Usage
\`\`\`tsx
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';

<DocumentIcon fileName="report.pdf" />
<DocumentIcon fileName="spreadsheet.xlsx" />
\`\`\`

## Features
- Automatic file type detection from extension
- Uses Microsoft Graph Toolkit for consistent Office icons
- Fallback icon while loading
- Dynamically loaded to reduce bundle size
        `,
      },
    },
  },
  argTypes: {
    fileName: {
      control: 'text',
      description: 'File name with extension for icon detection',
    },
  },
};

export default meta;
type Story = StoryObj<typeof DocumentIcon>;

export const Default: Story = {
  args: {
    fileName: 'document.pdf',
  },
};

export const PDFDocument: Story = {
  args: {
    fileName: 'report.pdf',
  },
};

export const WordDocument: Story = {
  args: {
    fileName: 'letter.docx',
  },
};

export const ExcelSpreadsheet: Story = {
  args: {
    fileName: 'budget.xlsx',
  },
};

export const PowerPointPresentation: Story = {
  args: {
    fileName: 'presentation.pptx',
  },
};

export const ImageFile: Story = {
  args: {
    fileName: 'photo.jpg',
  },
};

export const TextFile: Story = {
  args: {
    fileName: 'notes.txt',
  },
};

export const AllFileTypes: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-6">
      {[
        'document.pdf',
        'report.docx',
        'data.xlsx',
        'slides.pptx',
        'image.png',
        'photo.jpg',
        'notes.txt',
        'archive.zip',
        'video.mp4',
        'audio.mp3',
        'code.js',
        'styles.css',
      ].map((fileName) => (
        <div key={fileName} className="flex flex-col items-center gap-2">
          <DocumentIcon fileName={fileName} />
          <span className="text-muted-foreground text-xs">{fileName}</span>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Various file type icons.',
      },
    },
  },
};

export const InListContext: Story = {
  render: () => (
    <div className="w-72 divide-y rounded-lg border">
      {[
        { name: 'Project Proposal.docx', size: '24 KB' },
        { name: 'Budget 2024.xlsx', size: '156 KB' },
        { name: 'Presentation.pptx', size: '2.4 MB' },
        { name: 'Contract.pdf', size: '89 KB' },
      ].map((file) => (
        <div
          key={file.name}
          className="hover:bg-muted/50 flex items-center gap-3 p-3"
        >
          <DocumentIcon fileName={file.name} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-muted-foreground text-xs">{file.size}</p>
          </div>
        </div>
      ))}
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example usage in a file list.',
      },
    },
  },
};

export const CustomSize: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <DocumentIcon fileName="small.pdf" className="size-5" />
      <DocumentIcon fileName="medium.pdf" className="size-7" />
      <DocumentIcon fileName="large.pdf" className="size-10" />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Custom sizes using className.',
      },
    },
  },
};
