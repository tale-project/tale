import type { Meta, StoryObj } from '@storybook/react';
import { CardSkeleton, CardGridSkeleton } from './card-skeleton';
import { TableSkeleton, TableRowSkeleton } from './table-skeleton';
import { FormSkeleton } from './form-skeleton';
import { ListSkeleton, ListItemSkeleton } from './list-skeleton';
import { NavigationSkeleton, TabNavigationSkeleton } from './navigation-skeleton';
import { PageHeaderSkeleton } from './page-header-skeleton';

const meta: Meta = {
  title: 'Feedback/Skeletons',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Skeleton loading components for various UI patterns.

## Usage
\`\`\`tsx
import { CardSkeleton, TableSkeleton } from '@/components/skeletons';

// Show skeleton while loading
{isLoading ? <CardSkeleton /> : <Card>...</Card>}
\`\`\`

## Accessibility
- Skeletons use \`animate-pulse\` for visual feedback
- Content should be loaded progressively to reduce perceived wait time
        `,
      },
    },
  },
};

export default meta;

export const Cards: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Basic Card</h3>
        <div className="w-80">
          <CardSkeleton />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Card with Image</h3>
        <div className="w-80">
          <CardSkeleton showImage lines={2} />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Card with Actions</h3>
        <div className="w-80">
          <CardSkeleton lines={2} showActions />
        </div>
      </div>
    </div>
  ),
};

export const CardGrid: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">3-Column Grid</h3>
        <CardGridSkeleton count={6} columns={3} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">2-Column Grid with Images</h3>
        <CardGridSkeleton count={4} columns={2} cardProps={{ showImage: true, lines: 2 }} />
      </div>
    </div>
  ),
};

export const Tables: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Basic Table</h3>
        <TableSkeleton rows={5} columns={4} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Table with Headers</h3>
        <TableSkeleton rows={3} headers={['Name', 'Status', 'Date', 'Actions']} />
      </div>
    </div>
  ),
};

export const Forms: StoryObj = {
  render: () => (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h3 className="text-sm font-medium mb-4">Single Column Form</h3>
        <FormSkeleton fields={3} hasTextarea showActions />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Two Column Form</h3>
        <FormSkeleton fields={4} hasTextarea showActions layout="two-column" />
      </div>
    </div>
  ),
};

export const Lists: StoryObj = {
  render: () => (
    <div className="space-y-8 max-w-md">
      <div>
        <h3 className="text-sm font-medium mb-4">Basic List</h3>
        <ListSkeleton items={4} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">List with Actions</h3>
        <ListSkeleton items={3} itemProps={{ showAction: true }} showDividers />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Simple List (no avatar)</h3>
        <ListSkeleton items={3} itemProps={{ showAvatar: false }} />
      </div>
    </div>
  ),
};

export const Navigation: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Vertical Navigation</h3>
        <div className="w-48 border rounded-lg">
          <NavigationSkeleton items={5} orientation="vertical" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Horizontal Navigation</h3>
        <NavigationSkeleton items={4} orientation="horizontal" />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Tab Navigation</h3>
        <TabNavigationSkeleton tabs={['Documents', 'Websites', 'Products', 'Settings']} />
      </div>
    </div>
  ),
};

export const PageHeaders: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Simple Header</h3>
        <PageHeaderSkeleton />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Header with Breadcrumbs</h3>
        <PageHeaderSkeleton showBreadcrumbs />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Header with Actions</h3>
        <PageHeaderSkeleton showActions actionCount={2} />
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Full Header</h3>
        <PageHeaderSkeleton showBreadcrumbs showActions actionCount={2} />
      </div>
    </div>
  ),
};

export const SingleItems: StoryObj = {
  render: () => (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-medium mb-4">Single List Item</h3>
        <div className="max-w-md border rounded-lg">
          <ListItemSkeleton showAvatar showSecondary showAction />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium mb-4">Single Table Row</h3>
        <table className="w-full">
          <tbody>
            <TableRowSkeleton columns={5} />
          </tbody>
        </table>
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Individual skeleton items for inline loading states.',
      },
    },
  },
};
