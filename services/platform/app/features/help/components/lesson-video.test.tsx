import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { LessonVideo } from './lesson-video';

describe('LessonVideo', () => {
  it('renders a "coming soon" placeholder when no video is configured', () => {
    render(<LessonVideo lessonTitle="What is a large language model?" />);
    // The placeholder copy comes from the real `help.video.unavailable` string.
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).toBeInTheDocument();
    // No <video> element is mounted in the placeholder branch.
    expect(document.querySelector('video')).toBeNull();
  });

  it('renders a self-hosted video element when a source is provided', () => {
    render(
      <LessonVideo
        videoSrc="/help-videos/intro.mp4"
        lessonTitle="What is a large language model?"
      />,
    );
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.querySelector('source')?.getAttribute('src')).toBe(
      '/help-videos/intro.mp4',
    );
    // Labelled for assistive tech via the lesson title.
    expect(video?.getAttribute('aria-label')).toContain(
      'What is a large language model?',
    );
  });

  it('placeholder passes the axe audit', async () => {
    const { container } = render(
      <LessonVideo lessonTitle="Limitations and hallucinations" />,
    );
    await checkAccessibility(container);
  });
});
