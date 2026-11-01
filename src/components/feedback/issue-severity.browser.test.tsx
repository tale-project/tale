import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ISSUE_SEVERITY_CHIP_CLASS,
  ISSUE_SEVERITY_FRAME_CLASS,
  ISSUE_SEVERITY_ICON_CLASS,
} from './issue-severity';

import '../../globals.css';

/**
 * The severity colours, measured. axe judges text only, and gives up on a
 * one-digit chip ("too short to determine"), so this reads the colours the
 * shipped CSS resolves to, lays each over the surfaces it sits on in a
 * canvas, and checks the WCAG ratio: 4.5:1 for chip and message text, 3:1
 * for the glyphs and frames that tell a warning from an error by sight.
 */

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

type Rgb = readonly [number, number, number];

const pixel = document.createElement('canvas');
pixel.width = 1;
pixel.height = 1;
const context = pixel.getContext('2d', { willReadFrequently: true })!;

/** Paints `layers` bottom-up on white and reads the colour that results. */
function composite(layers: readonly string[]): Rgb {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1, 1);
  for (const layer of layers) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.039_28
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

/** Every background from the page down to `element`, outermost first. */
function backgroundsOf(element: Element): string[] {
  const layers: string[] = [];
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    layers.unshift(getComputedStyle(node).backgroundColor);
  }
  return layers;
}

/** The ratio of `element`'s `property` colour to what lies behind it. */
function ratioOf(
  element: Element,
  property: 'color' | 'borderTopColor' = 'color',
): number {
  const behind = backgroundsOf(element);
  return contrast(
    composite([...behind, getComputedStyle(element)[property]]),
    composite(behind),
  );
}

const SURFACES = ['bg-background', 'bg-card', 'bg-muted'] as const;

describe.each(['light', 'dark'])('issue severity colours (%s)', (theme) => {
  it.each(SURFACES)('keep their contrast on %s', (surface) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(
      <div className={surface}>
        {(['error', 'warning'] as const).map((severity) => (
          <div key={severity} data-severity={severity}>
            <span
              data-part="chip"
              className={ISSUE_SEVERITY_CHIP_CLASS[severity]}
            >
              2
            </span>
            <span
              data-part="icon"
              className={ISSUE_SEVERITY_ICON_CLASS[severity]}
            >
              icon
            </span>
            {/* A list row's hover and current-row fill. */}
            <span className="bg-muted/60">
              <span
                data-part="icon-on-row"
                className={ISSUE_SEVERITY_ICON_CLASS[severity]}
              >
                icon
              </span>
            </span>
          </div>
        ))}
        <span data-part="message" className="text-destructive">
          A field's error line
        </span>
      </div>,
    );
    const part = (severity: string, name: string) =>
      container.querySelector(
        `[data-severity="${severity}"] [data-part="${name}"]`,
      )!;

    for (const severity of ['error', 'warning']) {
      const label = `${theme} ${surface} ${severity}`;
      // A chip's number reads on its tint (chips sit on a node's card or the
      // page, but hold on the muted fill as well).
      expect(
        ratioOf(part(severity, 'chip')),
        `${label} chip`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        ratioOf(part(severity, 'icon')),
        `${label} icon`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        ratioOf(part(severity, 'icon-on-row')),
        `${label} icon on a row fill`,
      ).toBeGreaterThanOrEqual(3);
    }
    expect(
      ratioOf(container.querySelector('[data-part="message"]')!),
      `${theme} ${surface} error message`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  // A node's frame meets the canvas (the page) outside and the node's card
  // inside.
  it.each(['bg-background', 'bg-card'])(
    'keep a frame visible against %s',
    (surface) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = render(
        <div className={surface}>
          <span
            data-severity="error"
            className={`border ${ISSUE_SEVERITY_FRAME_CLASS.error}`}
          />
          <span
            data-severity="warning"
            className={`border ${ISSUE_SEVERITY_FRAME_CLASS.warning}`}
          />
        </div>,
      );
      for (const frame of container.querySelectorAll('[data-severity]')) {
        expect(
          ratioOf(frame, 'borderTopColor'),
          `${theme} ${surface} ${frame.getAttribute('data-severity')} frame`,
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );
});
