import { vi } from 'vitest';

/** Real change events exercise the media-query subscription, not a mocked hook. */
export function mockMotionPreference(reduced = false) {
  const media = Object.assign(new EventTarget(), {
    matches: reduced,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);

  return {
    change(matches: boolean) {
      media.matches = matches;
      media.dispatchEvent(Object.assign(new Event('change'), { matches }));
    },
  };
}
