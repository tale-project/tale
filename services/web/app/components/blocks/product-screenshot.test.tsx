import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductScreenshot } from './product-screenshot';

const preferences = vi.hoisted(() => ({
  inView: true,
  reduced: false,
  mobile: false,
  locale: 'en',
}));

const play = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('playing'));
  return Promise.resolve();
});
const pause = vi.fn(function (this: HTMLMediaElement) {
  this.dispatchEvent(new Event('pause'));
});
const canPlayType = vi.fn((_type: string): CanPlayTypeResult => 'probably');

vi.mock('@tale/marketing-ui/entrance', () => ({
  useReducedMotion: () => preferences.reduced,
}));
vi.mock('@tale/ui/use-media-query', () => ({
  useMediaQuery: () => preferences.mobile,
}));
vi.mock('framer-motion', () => ({ useInView: () => preferences.inView }));
vi.mock('@/lib/i18n/use-current-locale', () => ({
  useCurrentLocale: () => preferences.locale,
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));
vi.mock('@/app/generated/product-motion', () => ({
  PRODUCT_MOTION: {
    agents: Object.fromEntries(
      ['en', 'de', 'fr'].map((locale) => [
        locale,
        Object.fromEntries(
          ['desktop', 'mobile'].map((variant) => [
            variant,
            {
              webm: `/marketing/product-motion/${locale}/agents-${variant}.webm`,
              mp4: `/marketing/product-motion/${locale}/agents-${variant}.mp4`,
              width: 1280,
              height: 464,
              durationMs: 8000,
              webmBytes: 100000,
              mp4Bytes: 120000,
              posterId: `project-agents-models-${locale}-${variant}`,
            },
          ]),
        ),
      ]),
    ),
  },
}));

beforeEach(() => {
  Object.assign(preferences, {
    inView: true,
    reduced: false,
    mobile: false,
    locale: 'en',
  });
  play.mockClear();
  pause.mockClear();
  canPlayType.mockReturnValue('probably');
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(
    canPlayType,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function runningVideo(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
  return container.querySelector('video')!;
}

describe('captured product motion', () => {
  it('renders a complete responsive image and full-size link without server media sources', () => {
    const html = renderToStaticMarkup(<ProductScreenshot page="agents" />);
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('picture img')?.getAttribute('alt')).toBe(
      'pages.agents.label',
    );
    expect(document.querySelector('picture source[media]')).not.toBeNull();
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('a')?.getAttribute('href')).toContain(
      'project-agents-models-en-2880.webp',
    );
  });

  it.each(['reduced', 'offscreen', 'unsupported'] as const)(
    'keeps the image complete and makes no play request when initially %s',
    async (condition) => {
      preferences.reduced = condition === 'reduced';
      preferences.inView = condition !== 'offscreen';
      if (condition === 'unsupported') {
        canPlayType.mockReturnValue('');
      }
      const { container } = render(<ProductScreenshot page="agents" />);
      await waitFor(() => expect(screen.getByRole('img')).toBeDefined());
      expect(container.querySelector('video')).toBeNull();
      expect(play).not.toHaveBeenCalled();
      expect(
        screen
          .getByRole('link', { name: 'pages.viewLabel' })
          .getAttribute('href'),
      ).toContain('project-agents-models-en-2880.webp');
    },
  );

  it.each(['en', 'de', 'fr', 'de-CH'])(
    'uses the localized phone clip and keeps its control outside the image frame in %s',
    async (locale) => {
      preferences.locale = locale;
      preferences.mobile = true;
      const { container } = render(<ProductScreenshot page="agents" />);
      const video = await runningVideo(container);
      const sourceLocale = locale === 'de-CH' ? 'de' : locale;
      expect(video.querySelector('source')?.getAttribute('src')).toBe(
        `/marketing/product-motion/${sourceLocale}/agents-mobile.webm`,
      );
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.preload).toBe('none');
      expect(
        screen.getByRole('button', { name: 'pages.pauseMotion' }).closest('a'),
      ).toBeNull();
    },
  );

  it('keeps a deliberate pause through leaving and returning to the viewport', async () => {
    const { container, rerender } = render(<ProductScreenshot page="agents" />);
    await runningVideo(container);
    fireEvent.click(screen.getByRole('button', { name: 'pages.pauseMotion' }));
    const plays = play.mock.calls.length;
    preferences.inView = false;
    rerender(<ProductScreenshot page="agents" />);
    preferences.inView = true;
    rerender(<ProductScreenshot page="agents" />);
    expect(play).toHaveBeenCalledTimes(plays);
    expect(
      screen.getByRole('button', { name: 'pages.playMotion' }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'pages.playMotion' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(plays + 1));
  });

  it('loads the selected viewport source and waits for its own decoded frame after every resize', async () => {
    const { container, rerender } = render(<ProductScreenshot page="agents" />);
    const desktop = await runningVideo(container);
    fireEvent.loadedData(desktop);
    expect(desktop.classList.contains('visible')).toBe(true);

    preferences.mobile = true;
    rerender(<ProductScreenshot page="agents" />);
    const mobile = await runningVideo(container);
    expect(mobile).not.toBe(desktop);
    expect(mobile.querySelector('source')?.getAttribute('src')).toContain(
      'agents-mobile.webm',
    );
    fireEvent.loadedData(desktop);
    expect(mobile.classList.contains('invisible')).toBe(true);
    fireEvent.loadedData(mobile);
    expect(mobile.classList.contains('visible')).toBe(true);

    preferences.mobile = false;
    rerender(<ProductScreenshot page="agents" />);
    const returnedDesktop = await runningVideo(container);
    expect(returnedDesktop).not.toBe(desktop);
    expect(
      returnedDesktop.querySelector('source')?.getAttribute('src'),
    ).toContain('agents-desktop.webm');
    expect(returnedDesktop.classList.contains('invisible')).toBe(true);
    fireEvent.loadedData(mobile);
    expect(returnedDesktop.classList.contains('invisible')).toBe(true);
    fireEvent.loadedData(returnedDesktop);
    expect(returnedDesktop.classList.contains('visible')).toBe(true);
  });

  it('keeps the user pause when the viewport selects a different recording', async () => {
    const { container, rerender } = render(<ProductScreenshot page="agents" />);
    await runningVideo(container);
    fireEvent.click(screen.getByRole('button', { name: 'pages.pauseMotion' }));
    const plays = play.mock.calls.length;
    preferences.mobile = true;
    rerender(<ProductScreenshot page="agents" />);
    expect(container.querySelector('video')).toBeNull();
    expect(play).toHaveBeenCalledTimes(plays);
    fireEvent.click(screen.getByRole('button', { name: 'pages.playMotion' }));
    const mobile = await runningVideo(container);
    expect(mobile.querySelector('source')?.getAttribute('src')).toContain(
      'agents-mobile.webm',
    );
    expect(play).toHaveBeenCalledTimes(plays + 1);
  });

  it('pauses when the document is hidden or reduced motion changes after playback', async () => {
    const { container, rerender } = render(<ProductScreenshot page="agents" />);
    await runningVideo(container);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(container.querySelector('figure')?.dataset.productMotionState).toBe(
      'poster',
    );
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    preferences.reduced = true;
    rerender(<ProductScreenshot page="agents" />);
    expect(container.querySelector('figure')?.dataset.productMotionState).toBe(
      'poster',
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole('img')).toBeDefined();
  });

  it.each(['NotAllowedError', 'AbortError'])(
    'keeps the media and explicit Play action after a recoverable %s',
    async (name) => {
      let rejectPlay: ((reason: DOMException) => void) | undefined;
      play.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectPlay = reject;
          }),
      );
      const { container } = render(<ProductScreenshot page="agents" />);
      const video = await runningVideo(container);
      const sources = Array.from(video.querySelectorAll('source'));
      const sourcePaths = sources.map((source) => source.getAttribute('src'));
      expect(sources).toHaveLength(2);
      expect(rejectPlay).toBeDefined();
      rejectPlay?.(new DOMException('Playback needs a user retry', name));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'pages.playMotion' }),
        ).toBeDefined(),
      );
      expect(screen.getByRole('img')).toBeDefined();
      expect(container.querySelector('video')).toBe(video);
      expect(
        container.querySelector('figure')?.dataset.productMotionState,
      ).toBe('paused');
      expect(video.querySelectorAll('source')[0]).toBe(sources[0]);
      expect(video.querySelectorAll('source')[1]).toBe(sources[1]);
      const attempts = play.mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: 'pages.playMotion' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'pages.pauseMotion' }),
        ).toBeDefined(),
      );
      expect(play).toHaveBeenCalledTimes(attempts + 1);
      expect(play.mock.contexts.at(-1)).toBe(video);
      expect(container.querySelector('video')).toBe(video);
      expect(video.querySelectorAll('source')[0]).toBe(sources[0]);
      expect(video.querySelectorAll('source')[1]).toBe(sources[1]);
      expect(sources.map((source) => source.getAttribute('src'))).toEqual(
        sourcePaths,
      );
      expect(
        container.querySelector('figure')?.dataset.productMotionState,
      ).toBe('playing');
    },
  );

  it('removes failed media and preserves the responsive image and original inspection link', async () => {
    const { container } = render(<ProductScreenshot page="agents" />);
    const video = await runningVideo(container);
    fireEvent.error(video);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('figure')?.dataset.productMotionState).toBe(
      'error',
    );
    expect(screen.getByRole('img')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen
        .getByRole('link', { name: 'pages.viewLabel' })
        .getAttribute('href'),
    ).toContain('project-agents-models-en-2880.webp');
  });

  it('lets the native player try the next codec when a source reports a network error', async () => {
    const { container } = render(<ProductScreenshot page="agents" />);
    const video = await runningVideo(container);
    fireEvent.error(video.querySelector('source')!);
    expect(container.querySelector('video')).toBe(video);
    expect(video.querySelectorAll('source')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'pages.pauseMotion' }),
    ).toBeDefined();
    fireEvent.loadedData(video);
    expect(video.classList.contains('visible')).toBe(true);
  });

  it('returns to the image when all native codec sources report network errors', async () => {
    const { container } = render(<ProductScreenshot page="agents" />);
    const video = await runningVideo(container);
    const [webm, mp4] = video.querySelectorAll('source');
    fireEvent.error(webm!);
    expect(container.querySelector('video')).toBe(video);
    fireEvent.error(mp4!);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('figure')?.dataset.productMotionState).toBe(
      'error',
    );
    expect(screen.getByRole('img')).toBeDefined();
    expect(screen.getByRole('link', { name: 'pages.viewLabel' })).toBeDefined();
  });

  it('returns to the image when the only supported codec fails', async () => {
    canPlayType.mockImplementation((type) =>
      type === 'video/mp4' ? 'probably' : '',
    );
    const { container } = render(<ProductScreenshot page="agents" />);
    const video = await runningVideo(container);
    fireEvent.error(video.querySelector('source[type="video/mp4"]')!);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('figure')?.dataset.productMotionState).toBe(
      'error',
    );
    expect(screen.getByRole('img')).toBeDefined();
  });
});
