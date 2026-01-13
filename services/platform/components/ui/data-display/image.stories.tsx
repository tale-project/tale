import type { Meta, StoryObj } from '@storybook/react';
import { Image } from './image';

const meta: Meta<typeof Image> = {
  title: 'Data Display/Image',
  component: Image,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
A custom image component with automatic fallback handling.

## Usage
\`\`\`tsx
import { Image } from '@/components/ui/data-display/image';

<Image
  src="https://example.com/photo.jpg"
  alt="Description"
  className="w-32 h-32 object-cover rounded-lg"
/>
\`\`\`

## Features
- Automatic fallback on error
- Lazy loading by default (use \`priority\` to disable)
- Full control over styling
- No Next.js remotePatterns configuration needed
        `,
      },
    },
  },
  argTypes: {
    src: {
      control: 'text',
      description: 'Image source URL',
    },
    alt: {
      control: 'text',
      description: 'Alternative text for accessibility',
    },
    fallbackSrc: {
      control: 'text',
      description: 'Fallback image URL when primary fails',
    },
    priority: {
      control: 'boolean',
      description: 'Disable lazy loading for above-the-fold images',
    },
  },
};

export default meta;
type Story = StoryObj<typeof Image>;

export const Default: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    alt: 'Profile photo',
    className: 'w-32 h-32 object-cover rounded-lg',
  },
};

export const WithFallback: Story = {
  args: {
    src: 'https://invalid-url-that-will-fail.com/image.jpg',
    alt: 'Image with fallback',
    className: 'w-32 h-32 object-cover rounded-lg',
  },
  parameters: {
    docs: {
      description: {
        story: 'Shows the fallback placeholder when the primary image fails to load.',
      },
    },
  },
};

export const CustomFallback: Story = {
  args: {
    src: 'https://invalid-url-that-will-fail.com/image.jpg',
    alt: 'Image with custom fallback',
    fallbackSrc: 'https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=200&h=200&fit=crop',
    className: 'w-32 h-32 object-cover rounded-lg',
  },
  parameters: {
    docs: {
      description: {
        story: 'Use a custom fallback image instead of the default placeholder.',
      },
    },
  },
};

export const Priority: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    alt: 'Priority loaded image',
    priority: true,
    className: 'w-32 h-32 object-cover rounded-lg',
  },
  parameters: {
    docs: {
      description: {
        story: 'Disable lazy loading for above-the-fold images with the priority prop.',
      },
    },
  },
};

export const CircleAvatar: Story = {
  args: {
    src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    alt: 'User avatar',
    className: 'w-16 h-16 object-cover rounded-full',
  },
  parameters: {
    docs: {
      description: {
        story: 'Round avatar style using border-radius.',
      },
    },
  },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <Image
        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop"
        alt="Small"
        className="w-8 h-8 object-cover rounded"
      />
      <Image
        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop"
        alt="Medium"
        className="w-16 h-16 object-cover rounded-lg"
      />
      <Image
        src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop"
        alt="Large"
        className="w-32 h-32 object-cover rounded-xl"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different sizes achieved through className.',
      },
    },
  },
};

export const AspectRatio: Story = {
  render: () => (
    <div className="flex gap-4">
      <Image
        src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop"
        alt="Landscape"
        className="w-48 h-32 object-cover rounded-lg"
      />
      <Image
        src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=400&fit=crop"
        alt="Portrait"
        className="w-32 h-48 object-cover rounded-lg"
      />
      <Image
        src="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=300&h=300&fit=crop"
        alt="Square"
        className="w-32 h-32 object-cover rounded-lg"
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Different aspect ratios with object-cover.',
      },
    },
  },
};
