import type { Meta, StoryObj } from '@storybook/react';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { HStack } from '../layout/layout';

const meta: Meta<typeof Avatar> = {
  title: 'Data Display/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
An avatar component for displaying user profile images with fallback support.

## Usage
\`\`\`tsx
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/data-display/avatar';

<Avatar>
  <AvatarImage src="/avatar.jpg" alt="User name" />
  <AvatarFallback>JD</AvatarFallback>
</Avatar>
\`\`\`

## Accessibility
- AvatarImage supports alt text for screen readers
- Fallback content is announced when image fails to load
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Default: Story = {
  render: () => (
    <Avatar>
      <AvatarImage
        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
        alt="John Doe"
      />
      <AvatarFallback>JD</AvatarFallback>
    </Avatar>
  ),
};

export const WithFallback: Story = {
  render: () => (
    <Avatar>
      <AvatarImage src="/nonexistent.jpg" alt="Jane Smith" />
      <AvatarFallback>JS</AvatarFallback>
    </Avatar>
  ),
  parameters: {
    docs: {
      description: {
        story: 'When the image fails to load, the fallback content is displayed.',
      },
    },
  },
};

export const Sizes: Story = {
  render: () => (
    <HStack gap={4} align="end">
      <Avatar className="size-6">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback className="text-xs">XS</AvatarFallback>
      </Avatar>
      <Avatar className="size-8">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback className="text-xs">SM</AvatarFallback>
      </Avatar>
      <Avatar className="size-10">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback>MD</AvatarFallback>
      </Avatar>
      <Avatar className="size-14">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback>LG</AvatarFallback>
      </Avatar>
      <Avatar className="size-20">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback className="text-xl">XL</AvatarFallback>
      </Avatar>
    </HStack>
  ),
};

export const Rounded: Story = {
  render: () => (
    <HStack gap={4} align="center">
      <Avatar>
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback>MD</AvatarFallback>
      </Avatar>
      <Avatar className="rounded-full">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback>FU</AvatarFallback>
      </Avatar>
      <Avatar className="rounded-lg">
        <AvatarImage
          src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
          alt="User"
        />
        <AvatarFallback>LG</AvatarFallback>
      </Avatar>
    </HStack>
  ),
};

export const Group: Story = {
  render: () => (
    <div className="flex -space-x-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <Avatar key={i} className="border-2 border-background">
          <AvatarImage
            src={`https://i.pravatar.cc/100?img=${i + 10}`}
            alt={`User ${i}`}
          />
          <AvatarFallback>U{i}</AvatarFallback>
        </Avatar>
      ))}
      <Avatar className="border-2 border-background">
        <AvatarFallback className="bg-muted text-muted-foreground text-xs">+5</AvatarFallback>
      </Avatar>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Avatars can be grouped together with overlapping effect.',
      },
    },
  },
};

export const WithStatus: Story = {
  render: () => (
    <HStack gap={6}>
      <div className="relative">
        <Avatar>
          <AvatarImage
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
            alt="User"
          />
          <AvatarFallback>ON</AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 size-3 rounded-full bg-green-500 border-2 border-background" />
      </div>
      <div className="relative">
        <Avatar>
          <AvatarImage
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
            alt="User"
          />
          <AvatarFallback>BU</AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 size-3 rounded-full bg-yellow-500 border-2 border-background" />
      </div>
      <div className="relative">
        <Avatar>
          <AvatarImage
            src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop"
            alt="User"
          />
          <AvatarFallback>OF</AvatarFallback>
        </Avatar>
        <span className="absolute bottom-0 right-0 size-3 rounded-full bg-gray-400 border-2 border-background" />
      </div>
    </HStack>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Add a status indicator to show online/busy/offline state.',
      },
    },
  },
};
