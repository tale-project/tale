import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Video } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface LessonVideoProps {
  /**
   * Same-origin URL of a self-hosted walkthrough clip, or `undefined` when no
   * clip has been produced yet. External (cross-origin) sources are
   * intentionally unsupported — the platform's CSP pins `media-src` to `'self'`
   * for offline / self-hosted deployments.
   */
  videoSrc?: string;
  /** Accessible title of the lesson, used to label the video region. */
  lessonTitle: string;
}

/**
 * Renders a lesson's video walkthrough.
 *
 * When `videoSrc` is set it plays a self-hosted clip with native controls;
 * otherwise it shows an accessible "coming soon" placeholder so the lesson
 * still reads as a structured learning unit. Keeping the embed self-hosted
 * (rather than a YouTube/Vimeo iframe) is the deliberate choice for this
 * product: the deployment CSP blocks third-party frames and media, and many
 * installs run fully offline.
 */
export function LessonVideo({ videoSrc, lessonTitle }: LessonVideoProps) {
  const { t } = useT('help');

  if (!videoSrc) {
    return (
      <div
        role="note"
        className="border-border-base bg-bg-elevated/40 flex aspect-video w-full items-center justify-center rounded-lg border"
      >
        <VStack gap={2} align="center" className="max-w-sm px-6 text-center">
          <Video aria-hidden className="text-fg-muted size-8" />
          <Text variant="muted" className="text-sm">
            {t('video.unavailable')}
          </Text>
        </VStack>
      </div>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      aria-label={t('video.label', { title: lessonTitle })}
      className="border-border-base aspect-video w-full rounded-lg border bg-black"
    >
      <source src={videoSrc} />
      {/* Self-hosted captions ship alongside each clip as a sibling WebVTT
          file, so a same-origin `.vtt` next to the video satisfies both the
          caption requirement and the `media-src 'self'` CSP. */}
      <track kind="captions" src={`${videoSrc}.vtt`} default />
      {t('video.unsupported')}
    </video>
  );
}
