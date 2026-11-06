import type { Meta, StoryObj } from '@storybook/react';

import { Video } from './video';

const meta = {
  title: 'markdown/Video',
  component: Video,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Video>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The shape docs pages author: poster + captions + figure caption. The
 *  sample sources 404 in Storybook — the chrome (border, poster box,
 *  caption bar, native controls) is what the story exercises. */
export const Tutorial: Story = {
  args: {
    src: '/videos/en/tutorials/ep1-welcome/ep1-welcome.en.mp4',
    poster: '/videos/en/tutorials/ep1-welcome/ep1-welcome.en.webp',
    captions: '/videos/en/tutorials/ep1-welcome/ep1-welcome.en.vtt',
    lang: 'en',
    title: 'Welcome to Tale',
    caption: 'Episode 1 — Welcome to Tale (3 min)',
  },
};

export const WithoutCaptionBar: Story = {
  args: {
    src: '/videos/en/tutorials/ep1-welcome/ep1-welcome.en.mp4',
    captions: '/videos/en/tutorials/ep1-welcome/ep1-welcome.en.vtt',
    lang: 'en',
    title: 'Welcome to Tale',
  },
};
