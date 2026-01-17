import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { FormDialog } from './form-dialog';
import { Input } from '../forms/input';
import { Select } from '../forms/select';
import { Textarea } from '../forms/textarea';
import { Button } from '../primitives/button';

const meta: Meta<typeof FormDialog> = {
  title: 'Dialog/FormDialog',
  component: FormDialog,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A dialog for form-based operations like create, edit, and settings.

## Usage
\`\`\`tsx
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';

<FormDialog
  open={isOpen}
  onOpenChange={setIsOpen}
  title="Create Item"
  onSubmit={handleSubmit}
  isSubmitting={isSubmitting}
>
  <Input label="Name" value={name} onChange={setName} />
</FormDialog>
\`\`\`

## Features
- Built-in form wrapper with submit handling
- Loading state during submission
- Cancel/Submit footer buttons
- Error boundary protection
- Large variant for complex forms
        `,
      },
    },
  },
  argTypes: {
    isSubmitting: {
      control: 'boolean',
      description: 'Whether the form is being submitted',
    },
    submitDisabled: {
      control: 'boolean',
      description: 'Whether the submit button is disabled',
    },
    large: {
      control: 'boolean',
      description: 'Use large dialog variant with scroll support',
    },
  },
};

export default meta;
type Story = StoryObj<typeof FormDialog>;

export const Default: Story = {
  render: function DefaultStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Form Dialog</Button>
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Create New Item"
          description="Fill out the form below to create a new item."
          onSubmit={(e) => {
            e.preventDefault();
            alert('Form submitted!');
            setOpen(false);
          }}
        >
          <Input label="Name" placeholder="Enter name" />
          <Input label="Email" type="email" placeholder="Enter email" />
        </FormDialog>
      </>
    );
  },
};

export const WithTrigger: Story = {
  render: () => (
    <FormDialog
      title="Edit Profile"
      description="Update your profile information."
      trigger={<Button>Edit Profile</Button>}
      onSubmit={(e) => {
        e.preventDefault();
        alert('Profile updated!');
      }}
    >
      <Input label="Display Name" defaultValue="John Doe" />
      <Textarea label="Bio" placeholder="Tell us about yourself" rows={3} />
    </FormDialog>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Use the trigger prop to render a button that opens the dialog.',
      },
    },
  },
};

export const Submitting: Story = {
  render: function SubmittingStory() {
    const [open, setOpen] = useState(true);

    return (
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Saving Changes"
        isSubmitting={true}
        onSubmit={(e) => e.preventDefault()}
      >
        <Input label="Name" defaultValue="John Doe" />
      </FormDialog>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state during form submission.',
      },
    },
  },
};

export const SubmitDisabled: Story = {
  render: function DisabledStory() {
    const [open, setOpen] = useState(true);

    return (
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Create Account"
        submitDisabled={true}
        onSubmit={(e) => e.preventDefault()}
      >
        <Input label="Email" placeholder="Enter email to enable submit" />
      </FormDialog>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Submit button disabled until form is valid.',
      },
    },
  },
};

export const LargeDialog: Story = {
  render: function LargeDialogStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Large Form</Button>
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Complete Registration"
          description="Please fill out all the required information."
          large
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <Input label="First Name" />
          <Input label="Last Name" />
          <Input label="Email" type="email" />
          <Input label="Phone" type="tel" />
          <Select
            label="Country"
            options={[
              { value: 'us', label: 'United States' },
              { value: 'uk', label: 'United Kingdom' },
              { value: 'de', label: 'Germany' },
            ]}
          />
          <Textarea label="Address" rows={3} />
          <Textarea label="Notes" rows={4} />
        </FormDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Large dialog variant with scroll support for complex forms.',
      },
    },
  },
};

export const CustomButtonText: Story = {
  render: function CustomTextStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Create Item</Button>
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Create Item"
          cancelText="Discard"
          submitText="Create Item"
          submittingText="Creating..."
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <Input label="Item Name" />
        </FormDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom button text for cancel and submit actions.',
      },
    },
  },
};

export const CustomFooter: Story = {
  render: function CustomFooterStory() {
    const [open, setOpen] = useState(false);

    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Dialog</Button>
        <FormDialog
          open={open}
          onOpenChange={setOpen}
          title="Custom Footer Example"
          customFooter={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Skip for now
              </Button>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Save Draft
              </Button>
              <Button type="submit">
                Publish
              </Button>
            </>
          }
          onSubmit={(e) => {
            e.preventDefault();
            setOpen(false);
          }}
        >
          <Input label="Title" />
          <Textarea label="Content" rows={4} />
        </FormDialog>
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story: 'Custom footer with multiple action buttons.',
      },
    },
  },
};
