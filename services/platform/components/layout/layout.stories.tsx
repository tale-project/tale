import type { Meta, StoryObj } from '@storybook/react';
import { PageHeader, PageHeaderTitle } from './page-header';
import { ContentWrapper } from './content-wrapper';
import { StickyHeader } from './sticky-header';
import { AccessDenied } from './access-denied';
import { Button } from '@/components/ui/primitives/button';

const meta: Meta = {
  title: 'Layout/Page Components',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
Layout components for building consistent page structures.

## Usage
\`\`\`tsx
import { PageHeader, PageHeaderTitle, ContentWrapper } from '@/components/layout';

<PageHeader>
  <PageHeaderTitle>Page Title</PageHeaderTitle>
</PageHeader>
<ContentWrapper>
  {/* Page content */}
</ContentWrapper>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

export const PageHeaderBasic: StoryObj = {
  render: () => (
    <div className="border rounded-lg overflow-hidden">
      <PageHeader standalone={false}>
        <PageHeaderTitle>Dashboard</PageHeaderTitle>
      </PageHeader>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Basic page header with title.',
      },
    },
  },
};

export const PageHeaderWithActions: StoryObj = {
  render: () => (
    <div className="border rounded-lg overflow-hidden">
      <PageHeader standalone={false} className="justify-between">
        <PageHeaderTitle>Documents</PageHeaderTitle>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm">
            Export
          </Button>
          <Button size="sm">New Document</Button>
        </div>
      </PageHeader>
    </div>
  ),
};

export const PageHeaderWithBorder: StoryObj = {
  render: () => (
    <div className="border rounded-lg overflow-hidden">
      <PageHeader standalone={false} showBorder>
        <PageHeaderTitle>Settings</PageHeaderTitle>
      </PageHeader>
      <div className="p-4">
        <p className="text-muted-foreground">Page content goes here...</p>
      </div>
    </div>
  ),
};

export const ContentWrapperExample: StoryObj = {
  render: () => (
    <div className="h-64 border rounded-lg overflow-hidden flex flex-col">
      <PageHeader standalone={false} showBorder>
        <PageHeaderTitle>Page with Content</PageHeaderTitle>
      </PageHeader>
      <ContentWrapper className="p-4 overflow-auto">
        <div className="space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="p-4 bg-muted rounded-lg">
              Content item {i + 1}
            </div>
          ))}
        </div>
      </ContentWrapper>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'ContentWrapper provides flex-1 and min-h-0 for proper scrolling.',
      },
    },
  },
};

export const StickyHeaderExample: StoryObj = {
  render: () => (
    <div className="h-96 border rounded-lg overflow-auto">
      <StickyHeader>
        <PageHeader standalone={false} showBorder>
          <PageHeaderTitle>Sticky Header</PageHeaderTitle>
        </PageHeader>
      </StickyHeader>
      <div className="p-4 space-y-4">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="p-4 bg-muted/50 rounded-lg">
            Scroll to see the sticky header - Item {i + 1}
          </div>
        ))}
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'StickyHeader wraps content with sticky positioning and backdrop blur.',
      },
    },
  },
};

export const AccessDeniedExample: StoryObj = {
  render: () => (
    <div className="h-96 border rounded-lg overflow-hidden">
      <AccessDenied
        title="Access Denied"
        message="You don't have permission to view this page. Please contact your administrator."
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'AccessDenied component for permission errors.',
      },
    },
  },
};

export const FullPageLayout: StoryObj = {
  render: () => (
    <div className="h-[500px] border rounded-lg overflow-hidden flex flex-col">
      <StickyHeader>
        <PageHeader standalone={false} showBorder className="justify-between">
          <PageHeaderTitle>Full Page Layout</PageHeaderTitle>
          <Button size="sm">Action</Button>
        </PageHeader>
      </StickyHeader>
      <ContentWrapper className="overflow-auto">
        <div className="p-4 space-y-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="p-6 bg-card border rounded-lg">
              <h3 className="font-medium mb-2">Card {i + 1}</h3>
              <p className="text-sm text-muted-foreground">
                This demonstrates a full page layout with sticky header and scrollable content.
              </p>
            </div>
          ))}
        </div>
      </ContentWrapper>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Complete page layout combining all layout components.',
      },
    },
  },
};
