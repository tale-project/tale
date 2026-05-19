import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';
import { VideoLinkChip } from './video-link-chip';

const baseJob: VideoLinkJob = {
  jobId: 'job1' as VideoLinkJob['jobId'],
  sourceUrl: 'https://www.youtube.com/watch?v=abc',
  sourcePlatform: 'youtube',
  pastedToken: 'https://www.youtube.com/watch?v=abc',
  uploadedBy: 'user1',
  displayStatus: 'queued',
  createdAt: Date.now(),
};

function makeJob(overrides: Partial<VideoLinkJob>): VideoLinkJob {
  return { ...baseJob, ...overrides };
}

describe('VideoLinkChip', () => {
  describe('accessibility', () => {
    it('passes axe audit in processing state', async () => {
      const { container } = render(
        <VideoLinkChip
          job={makeJob({ displayStatus: 'fetching_captions' })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in completed state', async () => {
      const { container } = render(
        <VideoLinkChip
          job={makeJob({
            displayStatus: 'completed',
            videoTitle: 'Sample video title',
            videoDurationSec: 125,
          })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in failed state', async () => {
      const { container } = render(
        <VideoLinkChip
          job={makeJob({
            displayStatus: 'failed',
            errorReasonCode: 'botDetection',
          })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in retrying state with attempt token', async () => {
      const { container } = render(
        <VideoLinkChip
          job={makeJob({
            displayStatus: 'retrying',
            // Server emits the structured token; chip resolves it to the
            // localized "Attempt N" label via i18n.
            progress: '__VL_ATTEMPT__2',
            attempts: 2,
            errorReasonCode: 'transient',
          })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('rendering', () => {
    it('renders the title with the external-link affordance when sourceUrl present', () => {
      const { container } = render(
        <VideoLinkChip
          job={makeJob({
            videoTitle: 'My video',
            sourceUrl: 'https://youtu.be/abc',
          })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      const link = container.querySelector('a[href="https://youtu.be/abc"]');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('rel')).toContain('noopener');
      expect(link?.getAttribute('rel')).toContain('noreferrer');
      expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('exposes a retry button when the job is failed', () => {
      const { getAllByRole } = render(
        <VideoLinkChip
          job={makeJob({
            displayStatus: 'failed',
            errorReasonCode: 'transient',
          })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      // Two buttons: retry (failed-state-only) + remove.
      const buttons = getAllByRole('button');
      expect(buttons.length).toBe(2);
    });

    it('exposes only the remove button when not failed', () => {
      const { getAllByRole } = render(
        <VideoLinkChip
          job={makeJob({ displayStatus: 'completed' })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      const buttons = getAllByRole('button');
      expect(buttons.length).toBe(1);
    });

    it('sets aria-busy=true while processing and false on terminal states', () => {
      const processing = render(
        <VideoLinkChip
          job={makeJob({ displayStatus: 'extracting_audio' })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      // The outer role=group is the chip wrapper.
      const groupProcessing =
        processing.container.querySelector('[role="group"]');
      expect(groupProcessing?.getAttribute('aria-busy')).toBe('true');

      const completed = render(
        <VideoLinkChip
          job={makeJob({ displayStatus: 'completed' })}
          onCancel={vi.fn()}
          onRetry={vi.fn()}
        />,
      );
      const groupCompleted =
        completed.container.querySelector('[role="group"]');
      expect(groupCompleted?.getAttribute('aria-busy')).toBe('false');
    });
  });
});
