/**
 * Contrast as the browser paints it, for real-Chromium tests: reads the
 * colours the shipped CSS resolves to, lays each over what lies behind it
 * on a 1×1 canvas, and answers the WCAG ratio. axe judges text only (and
 * gives up on short text); lines, glyphs and borders need this.
 */

type Rgb = readonly [number, number, number];

let context: CanvasRenderingContext2D | null = null;

function pixel(): CanvasRenderingContext2D {
  if (context === null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null)
      throw new Error('No 2D canvas to measure contrast on');
  }
  return context;
}

/** Paints `layers` bottom-up on white and reads the colour that results. */
function composite(layers: readonly string[]): Rgb {
  const ctx = pixel();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1, 1);
  for (const layer of layers) {
    ctx.fillStyle = layer;
    ctx.fillRect(0, 0, 1, 1);
  }
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
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
  )
    layers.unshift(getComputedStyle(node).backgroundColor);
  return layers;
}

/** The ratio of `color` (any CSS colour) to the layers behind `element`. */
export function ratioAgainst(element: Element, color: string): number {
  const behind = backgroundsOf(element);
  return contrast(composite([...behind, color]), composite(behind));
}
