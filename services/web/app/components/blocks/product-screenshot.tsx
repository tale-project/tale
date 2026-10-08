import { useReducedMotion } from '@tale/marketing-ui/entrance';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { useInView } from 'framer-motion';
import { Expand, Pause, Play } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import {
  PRODUCT_SCREENSHOTS,
  type ProductScreenshotPage,
  productScreenshotId,
  productScreenshotLocale,
} from '@/app/content/product-screenshots';
import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '@/app/generated/image-manifest';
import {
  PRODUCT_MOTION,
  type ProductMotionVariant,
} from '@/app/generated/product-motion';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

function sourceSet(variants: ImageManifestEntry['variants']['webp']): string {
  return Object.entries(variants)
    .map(([width, path]) => `${path} ${width}w`)
    .join(', ');
}

/** Media sources are absent until the first visible, motion-permitted client
 * render. Visibility pauses playback without erasing the user's own choice. */
function useProductMotion(
  variant: ProductMotionVariant | undefined,
  figureRef: RefObject<HTMLElement | null>,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inView = useInView(figureRef, { amount: 0.15 });
  const reduceMotion = useReducedMotion();
  const key = variant?.webm ?? '';
  // Returning to a previous breakpoint still creates a new native media
  // element: its old decoded frame must not reveal the new loading element.
  const request = useMemo(
    () => ({ key, failedSources: new Set<string>() }),
    [key],
  );
  const [supported, setSupported] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeRequest, setActiveRequest] = useState<typeof request | null>(
    null,
  );
  const [decodedRequest, setDecodedRequest] = useState<typeof request | null>(
    null,
  );
  const [playingRequest, setPlayingRequest] = useState<typeof request | null>(
    null,
  );
  const [failedKey, setFailedKey] = useState('');
  const [manualPause, setManualPause] = useState(false);
  const eligible =
    supported && visible && inView && !reduceMotion && Boolean(variant);
  const failed = Boolean(key) && failedKey === key;
  const shouldPlay = eligible && !manualPause && !failed;
  const activated = Boolean(key) && activeRequest === request && !failed;
  const showFrame = activated && decodedRequest === request && eligible;

  useEffect(() => {
    const probe = document.createElement('video');
    setSupported(
      Boolean(
        probe.canPlayType('video/webm') || probe.canPlayType('video/mp4'),
      ),
    );
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (shouldPlay && key) setActiveRequest(request);
  }, [shouldPlay, key, request]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (!shouldPlay) {
      video.pause();
      return undefined;
    }
    let cancelled = false;
    void video.play().catch((error: unknown) => {
      if (cancelled) return;
      // A blocked autoplay can be started with the user's Play button.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setManualPause(true);
      } else {
        setFailedKey(key);
      }
    });
    return () => {
      cancelled = true;
      video.pause();
    };
  }, [activated, shouldPlay, key]);

  const state = failed
    ? 'error'
    : !eligible
      ? 'poster'
      : manualPause
        ? 'paused'
        : playingRequest === request
          ? 'playing'
          : activated
            ? 'loading'
            : 'poster';
  return {
    videoRef,
    activated,
    showFrame,
    manualPause,
    state,
    hasControls: Boolean(variant) && supported && !reduceMotion && !failed,
    togglePause: () => setManualPause((paused) => !paused),
    onLoadedData: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (event.currentTarget === videoRef.current) setDecodedRequest(request);
    },
    onPlaying: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (event.currentTarget === videoRef.current) setPlayingRequest(request);
    },
    onPause: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (event.currentTarget === videoRef.current) setPlayingRequest(null);
    },
    onError: (event: SyntheticEvent<HTMLVideoElement>) => {
      if (event.currentTarget !== videoRef.current) return;
      // React also delivers child <source> network errors. Allow the native
      // next codec, but browsers need not emit a terminal video error when
      // every child source has failed.
      if (
        event.target instanceof HTMLSourceElement &&
        event.target.closest('video') === event.currentTarget
      ) {
        request.failedSources.add(event.target.src);
        const exhausted = Array.from(
          event.currentTarget.querySelectorAll('source'),
        ).every(
          (source) =>
            !event.currentTarget.canPlayType(source.type) ||
            request.failedSources.has(source.src),
        );
        if (exhausted) setFailedKey(key);
      } else if (event.target === event.currentTarget) setFailedKey(key);
    },
  };
}

/** Unretouched product captures: responsive stills and native desktop/phone recordings. */
export function ProductScreenshot({ page }: { page: ProductScreenshotPage }) {
  const { t } = useT('demo');
  const locale = useCurrentLocale();
  const { source } = PRODUCT_SCREENSHOTS[page];
  const id = productScreenshotId(source, locale);
  const original = IMAGE_MANIFEST.find((entry) => entry.id === id);
  const stillDesktop =
    IMAGE_MANIFEST.find((entry) => entry.id === `${id}-desktop`) ?? original;
  const stillMobile = IMAGE_MANIFEST.find(
    (entry) => entry.id === `${id}-mobile`,
  );
  const recorded = PRODUCT_MOTION[page]?.[productScreenshotLocale(locale)];
  const motionDesktop = IMAGE_MANIFEST.find(
    (entry) => entry.id === recorded?.desktop.posterId,
  );
  const motionMobile = IMAGE_MANIFEST.find(
    (entry) => entry.id === recorded?.mobile.posterId,
  );
  // A partial generation never replaces a complete static capture.
  const motion =
    recorded && motionDesktop && motionMobile ? recorded : undefined;
  const desktop = motion ? motionDesktop : stillDesktop;
  const mobile = motion ? motionMobile : stillMobile;
  const figureRef = useRef<HTMLElement>(null);
  const videoId = useId();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const variant = isMobile ? motion?.mobile : motion?.desktop;
  const playback = useProductMotion(variant, figureRef);
  if (!original || !desktop || !mobile)
    throw new Error(`Missing optimized product capture: ${id}`);
  const full = Object.values(original.variants.webp).at(-1);
  const display = Object.values(desktop.variants.webp).at(-1);
  const sizes =
    page === 'home'
      ? '(min-width: 1360px) 700px, (min-width: 1024px) calc(58.33vw - 84px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)'
      : '(min-width: 1360px) 1264px, (min-width: 1024px) calc(100vw - 96px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)';

  return (
    <figure
      ref={figureRef}
      data-product-screenshot={page}
      data-product-motion-state={playback.state}
      data-demo-domain={page === 'home' || page === 'hub' ? 'projects' : page}
      className="w-full min-w-0"
    >
      <Card
        padding="none"
        radius="xl"
        className="shadow-demo bg-surface-site-raised relative block overflow-hidden"
      >
        <picture>
          <source
            media="(max-width: 639px)"
            type="image/avif"
            srcSet={sourceSet(mobile.variants.avif)}
            sizes={sizes}
            width={mobile.width}
            height={mobile.height}
          />
          <source
            media="(max-width: 639px)"
            type="image/webp"
            srcSet={sourceSet(mobile.variants.webp)}
            sizes={sizes}
            width={mobile.width}
            height={mobile.height}
          />
          <source
            type="image/avif"
            srcSet={sourceSet(desktop.variants.avif)}
            sizes={sizes}
          />
          <img
            src={display}
            srcSet={sourceSet(desktop.variants.webp)}
            sizes={sizes}
            width={desktop.width}
            height={desktop.height}
            alt={t(`pages.${page}.label`)}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="block h-auto w-full"
          />
        </picture>
        {playback.activated && variant ? (
          // This silent visual enhancement has the same localized image
          // alternative and figcaption; it introduces no narrated audio.
          <video
            key={variant.webm}
            ref={playback.videoRef}
            id={videoId}
            data-product-motion={page}
            data-product-motion-variant={isMobile ? 'mobile' : 'desktop'}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            width={variant.width}
            height={variant.height}
            className={`absolute inset-0 h-full w-full object-contain ${playback.showFrame ? 'visible' : 'invisible'}`}
            onLoadedData={playback.onLoadedData}
            onPlaying={playback.onPlaying}
            onPause={playback.onPause}
            onError={playback.onError}
          >
            <source src={variant.webm} type="video/webm" />
            <source src={variant.mp4} type="video/mp4" />
          </video>
        ) : null}
      </Card>
      <figcaption className="text-fg-muted mt-4 flex flex-wrap items-start justify-between gap-3 text-xs leading-relaxed">
        <span className="max-w-2xl">
          {t(`pages.${page}.caption`)}
          <span className="text-fg-subtle mt-1 block">
            {t('pages.interfaceLanguage')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {playback.hasControls ? (
            <Button
              data-product-motion-control
              type="button"
              variant="ghost"
              size="sm"
              icon={playback.manualPause ? Play : Pause}
              aria-controls={playback.activated ? videoId : undefined}
              className="min-h-11 px-2"
              onClick={playback.togglePause}
            >
              {t(
                playback.manualPause ? 'pages.playMotion' : 'pages.pauseMotion',
              )}
            </Button>
          ) : null}
          <a
            href={full}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-base focus-visible:outline-fg-base inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Expand aria-hidden className="size-3.5" />
            {t('pages.viewLabel')}
          </a>
        </span>
      </figcaption>
    </figure>
  );
}
