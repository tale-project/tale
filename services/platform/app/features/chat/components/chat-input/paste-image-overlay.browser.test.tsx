import { waitFor } from '@testing-library/react';
import { type CSSProperties, useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { PasteImageOverlay, type PasteImageChip } from './paste-image-overlay';

/**
 * REAL Chromium (project `browser`) test. The overlay positions its chips by
 * mirroring the textarea text into an off-screen `<div>` and reading each
 * token span's `offsetLeft/Top/Width/Height` — geometry jsdom fakes as 0, so
 * this needs real layout, hence the browser tier. Verifies the end-to-end
 * pipeline: a `[N]` token in the textarea gets a thumbnail/spinner chip painted
 * over it at a real position, and tokens without chip data are left alone.
 */

// Mirrors the composer textarea's box: zero padding/border so the overlay's
// "assumes zero padding" measurement holds.
const TEXTAREA_STYLE: CSSProperties = {
  minHeight: 72,
  width: 320,
  padding: 0,
  border: 0,
  margin: 0,
  font: '16px/1.5 sans-serif',
  resize: 'none',
  boxSizing: 'border-box',
};

// 1×1 transparent PNG — a valid <img> src so the "ready" chip renders an image.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function Harness({
  value,
  chips,
  onOpen = vi.fn(),
}: {
  value: string;
  chips: Map<number, PasteImageChip>;
  onOpen?: (id: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div style={{ position: 'relative', width: 320 }}>
      <textarea ref={ref} value={value} readOnly style={TEXTAREA_STYLE} />
      <PasteImageOverlay
        textareaRef={ref}
        value={value}
        chips={chips}
        onOpen={onOpen}
      />
    </div>
  );
}

function chipEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-token-id]'));
}

describe('PasteImageOverlay (real browser)', () => {
  it('paints a positioned chip over each pasted token and skips plain tokens', async () => {
    const chips = new Map<number, PasteImageChip>([
      [1, { status: 'ready', previewUrl: PIXEL }],
      [2, { status: 'uploading' }],
    ]);
    // `[3]` has no chip data (e.g. the user typed it) — must stay plain text.
    const { container } = render(
      <Harness value="see [1] and [2] not [3]" chips={chips} />,
    );

    await waitFor(() => expect(chipEls(container)).toHaveLength(2));

    const byId = new Map(
      chipEls(container).map((el) => [el.getAttribute('data-token-id'), el]),
    );
    const chip1 = byId.get('1');
    const chip2 = byId.get('2');
    if (!chip1 || !chip2) throw new Error('expected chips for tokens 1 and 2');
    expect(byId.has('3')).toBe(false);

    // Ready chip shows the uploaded thumbnail + its id; uploading chip shows a
    // spinner and no image.
    expect(chip1.querySelector('img')).toBeTruthy();
    expect(chip1.textContent).toContain('1');
    expect(chip2.querySelector('img')).toBeNull();
    expect(chip2.querySelector('svg')).toBeTruthy();

    // Real geometry: both chips have a measured box, and `[2]` sits to the
    // right of `[1]` on the same line (they fit in 320px).
    const r1 = chip1.getBoundingClientRect();
    const r2 = chip2.getBoundingClientRect();
    expect(r1.width).toBeGreaterThan(0);
    expect(r1.height).toBeGreaterThan(0);
    expect(r2.left).toBeGreaterThan(r1.left);
  });

  it('opens the preview when a ready chip is clicked', async () => {
    const onOpen = vi.fn();
    const { container, user } = render(
      <Harness
        value="look at [1]"
        chips={new Map([[1, { status: 'ready', previewUrl: PIXEL }]])}
        onOpen={onOpen}
      />,
    );

    await waitFor(() => expect(chipEls(container)).toHaveLength(1));
    await user.click(chipEls(container)[0]);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('renders nothing when there are no chips', () => {
    const { container } = render(
      <Harness value="just text [1]" chips={new Map()} />,
    );
    expect(chipEls(container)).toHaveLength(0);
  });
});
