import type { Meta, StoryObj } from '@storybook/react';
import { ValidationCheckList } from './validation-check-item';

const meta: Meta<typeof ValidationCheckList> = {
  title: 'Feedback/ValidationCheckList',
  component: ValidationCheckList,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Validation check components for displaying requirement lists.

## Usage
\`\`\`tsx
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';

<ValidationCheckList items={[
  { isValid: true, message: 'At least 8 characters' },
  { isValid: false, message: 'Contains a number' },
]} />
\`\`\`

## Accessibility
- Icons are decorative (aria-hidden)
- List uses proper role="list" semantics
- Items have aria-label describing status
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ValidationCheckList>;

export const PasswordRequirements: Story = {
  render: () => (
    <ValidationCheckList
      items={[
        { isValid: true, message: 'At least 8 characters' },
        { isValid: true, message: 'Contains uppercase letter' },
        { isValid: false, message: 'Contains a number' },
        { isValid: false, message: 'Contains special character (!@#$%)' },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'Common use case: password strength requirements.',
      },
    },
  },
};

export const AllValid: Story = {
  render: () => (
    <ValidationCheckList
      items={[
        { isValid: true, message: 'Required field' },
        { isValid: true, message: 'Valid email format' },
        { isValid: true, message: 'Unique username' },
        { isValid: true, message: 'Terms accepted' },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'All requirements have been met.',
      },
    },
  },
};

export const AllInvalid: Story = {
  render: () => (
    <ValidationCheckList
      items={[
        { isValid: false, message: 'Required field' },
        { isValid: false, message: 'Valid email format' },
        { isValid: false, message: 'Minimum 3 characters' },
      ]}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'No requirements have been met yet.',
      },
    },
  },
};

export const FormValidation: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <label className="text-sm font-medium">Username</label>
        <input
          type="text"
          className="w-full px-3 py-2 border rounded-lg text-sm"
          placeholder="Enter username"
          defaultValue="john"
        />
        <ValidationCheckList
          items={[
            { isValid: true, message: 'At least 3 characters' },
            { isValid: false, message: 'No spaces allowed' },
            { isValid: true, message: 'Only letters and numbers' },
          ]}
          className="mt-2"
        />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Validation checklist integrated with a form field.',
      },
    },
  },
};


export const AccountSetup: Story = {
  render: () => (
    <div className="p-4 border rounded-lg w-80">
      <h3 className="font-medium mb-3">Account Setup Progress</h3>
      <ValidationCheckList
        items={[
          { isValid: true, message: 'Created account' },
          { isValid: true, message: 'Verified email' },
          { isValid: false, message: 'Added profile picture' },
          { isValid: false, message: 'Connected calendar' },
          { isValid: false, message: 'Invited team members' },
        ]}
      />
      <p className="text-xs text-muted-foreground mt-3">2 of 5 complete</p>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Validation list used for onboarding progress.',
      },
    },
  },
};
