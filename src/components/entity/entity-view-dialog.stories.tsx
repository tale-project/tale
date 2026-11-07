import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { TooltipProvider } from '@tale/ui/tooltip';
import { BookOpen, Globe, Play } from 'lucide-react';
import { useState } from 'react';

import { EntityViewDialog, EntityViewSection } from './entity-view-dialog';

const meta: Meta<typeof EntityViewDialog> = {
  title: 'Dialog/EntityViewDialog',
  component: EntityViewDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
The details of one knowledge record — a product, contact, website, or knowledge
entry — in the layout every record shares: an identity block, the key facts,
then the record's own sections. It uses a compact identity header and a reading width, with height determined by its content.

## Usage
\`\`\`tsx
import {
  EntityViewDialog,
  EntityViewSection,
} from '@tale/ui/entity/entity-view-dialog';

<EntityViewDialog
  open={open}
  onOpenChange={setOpen}
  title="Website details"
  name={website.domain}
  summary={website.title}
  icon={Globe}
  badges={<Badge variant="green">Active</Badge>}
  edit={{
    label: 'Edit',
    render: ({ onBack, onDone }) => (
      <WebsiteEditDialog
        isOpen
        onClose={onBack}
        onSaved={onDone}
        website={website}
      />
    ),
  }}
  facts={[{ label: 'Scan interval', value: 'Every 1 day' }]}
>
  <EntityViewSection title="Website pages" meta="12 indexed">
    …
  </EntityViewSection>
</EntityViewDialog>
\`\`\`

## Features
- One identity block: image or small icon, name, inline status and actions
- Key facts in aligned metadata rows; long content uses the full width
- Copyable identifiers sit after the record content
- Edit hands the frame to the record's edit dialog; cancel returns, save closes
- Extra header shortcuts for the row menu's other verbs
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof EntityViewDialog>;

export const Default: Story = {
  render: function DefaultStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>View website</Button>
        <EntityViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Website details"
          name="example.com"
          summary="Example Domain"
          icon={Globe}
          badges={
            <Badge variant="green" dot>
              Active
            </Badge>
          }
          actions={[
            {
              key: 'resume',
              label: 'Resume scanning',
              icon: Play,
              onClick: () => undefined,
            },
          ]}
          identifier={{
            label: 'Website ID',
            value: '795c9221-156f-434e-a458-24625f59bde0',
          }}
          facts={[
            { label: 'Scan interval', value: 'Every 1 day' },
            { label: 'Last scanned', value: 'September 15, 2026 8:54 AM' },
            {
              label: 'Description',
              value: 'Illustrative examples for documentation.',
              colSpan: 2,
            },
          ]}
        >
          <EntityViewSection title="Website pages" meta="1 indexed">
            <p className="text-sm">https://example.com/</p>
          </EntityViewSection>
        </EntityViewDialog>
      </>
    );
  },
};

export const WithEdit: Story = {
  render: function WithEditStory() {
    const [open, setOpen] = useState(false);
    const [topic, setTopic] = useState('Return policy');

    return (
      <>
        <Button onClick={() => setOpen(true)}>View entry</Button>
        <EntityViewDialog
          open={open}
          onOpenChange={setOpen}
          title="Knowledge entry details"
          name={topic}
          badges={
            <Badge variant="green" dot>
              Indexed
            </Badge>
          }
          content={
            <p className="text-sm leading-relaxed">
              Customers can return unused items within 30 days of delivery.
              Refunds go back to the original payment method.
            </p>
          }
          identifier={{
            label: 'Entry ID',
            value: 'e2467808-ecb7-4661-9725-164de8201f0e',
          }}
          icon={BookOpen}
          edit={{
            label: 'Edit',
            render: ({ onBack, onDone }) => (
              <FormDialog
                open
                onOpenChange={(next) => !next && onBack()}
                title="Edit knowledge entry"
                size="entity"
                onSubmit={onDone}
              >
                <Input
                  label="Topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                />
              </FormDialog>
            ),
          }}
          facts={[
            { label: 'Source', value: 'Manual' },
            { label: 'Updated', value: 'September 14, 2026 11:11 AM' },
          ]}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Edit swaps the details for the edit form with focus restored when returning. Cancel returns to the details; saving closes both.',
      },
    },
  },
};
