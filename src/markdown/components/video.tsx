import { cn } from '../../lib/cn';

/**
 * Track labels for the caption file, keyed by its language. Kept local — the
 * component renders in plain markdown context with no i18n runtime.
 */
const TRACK_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
};

interface VideoProps {
  src?: string;
  poster?: string;
  /** WebVTT captions in the page's own language — required for a11y. */
  captions?: string;
  /** Language of the video's narration AND its captions track. */
  lang?: string;
  title?: string;
  caption?: string;
  className?: string;
}

/**
 * Bordered video figure for the docs — the moving-picture sibling of
 * `Frame`. Renders the native player (keyboard-accessible controls for
 * free), a poster so pages stay light until playback (`preload="metadata"`),
 * and a captions track, available but off by default.
 *
 * Authored as `<Video src poster captions lang title caption>`; rehype-raw
 * lowercases the tag to the native element name, so the registry maps
 * `video` here — attribute names stay single-word lowercase on purpose.
 */
export function Video({
  src,
  poster,
  captions,
  lang = 'en',
  title,
  caption,
  className,
}: VideoProps) {
  return (
    <figure
      className={cn(
        'border-border-base bg-bg-base my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the track is
          rendered whenever `captions` is provided; the docs test suite
          (videos.test.ts) fails any page embedding a video without one. */}
      <video
        className="block h-auto w-full"
        controls
        playsInline
        preload="metadata"
        src={src}
        poster={poster}
        title={title}
      >
        {captions ? (
          <track
            kind="captions"
            src={captions}
            srcLang={lang}
            label={TRACK_LABELS[lang] ?? lang}
          />
        ) : null}
      </video>
      {caption?.trim() ? (
        <figcaption className="text-fg-muted border-border-base bg-bg-elevated/60 border-t px-4 py-2 text-center text-xs">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
