import { contrastRatio } from '@/lib/utils/color';

/**
 * What a real browser paints, for component tests that judge colour
 * (`*.browser.test.tsx` only: jsdom has no canvas and no computed colours).
 */

/**
 * Any computed CSS colour, laid over `under` at `opacity`, as the `#rrggbb`
 * it paints.
 */
export function painted(css: string, under = '#ffffff', opacity = 1): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d canvas');
  context.fillStyle = under;
  context.fillRect(0, 0, 1, 1);
  context.globalAlpha = opacity;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The colour painted behind `el`: the backgrounds of it and its ancestors,
 * composited from the nearest opaque one up.
 */
function backdropOf(el: Element): string {
  const layers: string[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    const overBlack = painted(background, '#000000');
    const overWhite = painted(background, '#ffffff');
    if (overBlack === '#000000' && overWhite === '#ffffff') continue; // clear
    layers.push(background);
    if (overBlack === overWhite) break; // opaque: nothing above shows through
  }
  return layers.reduceRight((under, layer) => painted(layer, under), '#ffffff');
}

/**
 * The WCAG contrast of the text `el` (or its `pseudo` element) draws against
 * what is painted behind it, the text's own opacity included.
 */
export function inkContrast(el: Element, pseudo?: '::before' | '::after') {
  const style = getComputedStyle(el, pseudo);
  const backdrop = backdropOf(el);
  return contrastRatio(
    painted(style.color, backdrop, Number(style.opacity)),
    backdrop,
  );
}
