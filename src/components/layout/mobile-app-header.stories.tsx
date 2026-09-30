import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronLeft, Menu, MoreHorizontal, Search } from 'lucide-react';

import { IconButton } from '../primitives/icon-button';
import { MobileAppHeader } from './mobile-app-header';

const meta: Meta<typeof MobileAppHeader> = {
  title: 'Layout/MobileAppHeader',
  component: MobileAppHeader,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile1' },
  },
};
export default meta;

type Story = StoryObj<typeof MobileAppHeader>;

export const WithMenu: Story = {
  args: {
    ariaLabel: 'Page header',
    start: <IconButton aria-label="Open menu" variant="ghost" icon={Menu} />,
    children: 'Conversations',
    end: <IconButton aria-label="Search" variant="ghost" icon={Search} />,
  },
};

export const WithBackButton: Story = {
  args: {
    ariaLabel: 'Detail header',
    start: <IconButton aria-label="Back" variant="ghost" icon={ChevronLeft} />,
    children: 'Conversation #1234',
    end: <IconButton aria-label="More" variant="ghost" icon={MoreHorizontal} />,
  },
};

export const TitleOnly: Story = {
  args: {
    ariaLabel: 'Page header',
    children: 'Settings',
  },
};
