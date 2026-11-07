import type { Page } from '@playwright/test';

/** What marks the focused element, and how well it stands out from what is behind it. */
export interface FocusIndicator {
  /** The element, in words for a failure message. */
  element: string;
  /** The strongest of the outline, the rings and the border. */
  kind: 'outline' | 'ring' | 'border' | 'none';
  /** WCAG contrast ratio of that mark against the colour behind the element (1 when there is no mark). */
  contrast: number;
}

/** The lowest contrast WCAG 1.4.11 asks of a focus indicator. */
export const MIN_FOCUS_CONTRAST = 3;

/**
 * Measures the indicator of the element that has the focus now, from its
 * computed style: an outline, a ring (a spread shadow) or a border that stands
 * out from the page behind it. Mid-transition values read as "no mark yet", so
 * poll it (`expect.poll`) until the ring has settled.
 */
export function focusIndicatorOfFocused(
  page: Page,
  /**
   * The colour the element's border had before it had the focus: a border that
   * is not changed by the focus is the control's look, not a mark of the focus.
   */
  unfocusedBorder?: string,
): Promise<FocusIndicator> {
  return page.evaluate((borderBefore): FocusIndicator => {
    const element = document.activeElement;
    if (element === null || element === document.body) {
      return { element: 'the page', kind: 'none', contrast: 1 };
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('No 2d canvas to read colours with');
    type Colour = [number, number, number, number];
    // The canvas turns any CSS colour (oklch included) into sRGB.
    const toRgba = (css: string): Colour => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(
        0,
        0,
        1,
        1,
      ).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Colour, bottom: Colour): Colour => {
      const alpha = top[3];
      return [
        top[0] * alpha + bottom[0] * (1 - alpha),
        top[1] * alpha + bottom[1] * (1 - alpha),
        top[2] * alpha + bottom[2] * (1 - alpha),
        1,
      ];
    };
    const luminance = ([r, g, b]: Colour) => {
      const channel = (value: number) => {
        const unit = value / 255;
        return unit <= 0.039_28
          ? unit / 12.92
          : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: Colour, b: Colour) => {
      const [lighter = 0, darker = 0] = [luminance(a), luminance(b)].sort(
        (x, y) => y - x,
      );
      return (lighter + 0.05) / (darker + 0.05);
    };
    // What shows behind the element: the backgrounds of its ancestors (and,
    // for a mark drawn inside it, its own) laid over each other.
    const behind = (from: Element | null): Colour => {
      const chain: Element[] = [];
      for (let node = from; node; node = node.parentElement) chain.push(node);
      let colour: Colour = [255, 255, 255, 1];
      for (const node of chain.reverse()) {
        const background = toRgba(getComputedStyle(node).backgroundColor);
        if (background[3] > 0) colour = over(background, colour);
      }
      return colour;
    };

    const style = getComputedStyle(element);
    const outside = behind(element.parentElement);
    const inside = behind(element);
    const marks: Array<{ kind: FocusIndicator['kind']; contrast: number }> = [];

    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
      marks.push({
        kind: 'outline',
        contrast: ratio(over(toRgba(style.outlineColor), outside), outside),
      });
    }

    // The shadow list, split at the commas that are not inside a colour.
    const shadows: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of style.boxShadow) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ',' && depth === 0) {
        shadows.push(current.trim());
        current = '';
      } else {
        current += character;
      }
    }
    if (current.trim() !== '') shadows.push(current.trim());
    for (const shadow of shadows) {
      const parts =
        /^((?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|#[\da-f]+|[a-z]+)\s+(.*)$/i.exec(
          shadow,
        );
      if (parts === null) continue;
      const [, colour = '', geometry = ''] = parts;
      const [, , blur = 0, spread = 0] = (
        geometry.match(/-?[\d.]+(?=px)/g) ?? []
      ).map(Number);
      if (blur !== 0 || spread <= 0) continue;
      const surface = geometry.includes('inset') ? inside : outside;
      marks.push({
        kind: 'ring',
        contrast: ratio(over(toRgba(colour), surface), surface),
      });
    }

    // A border that stands out is a mark too (a field's border turns to the
    // accent), when the focus is what changed it.
    if (
      parseFloat(style.borderTopWidth) > 0 &&
      (borderBefore === undefined || style.borderTopColor !== borderBefore)
    ) {
      marks.push({
        kind: 'border',
        contrast: ratio(over(toRgba(style.borderTopColor), inside), inside),
      });
    }

    const label =
      element.getAttribute('aria-label') ??
      element.textContent?.trim().slice(0, 30) ??
      '';
    const best = marks.sort((a, b) => b.contrast - a.contrast)[0];
    return {
      element: `<${element.tagName.toLowerCase()}> ${label}`.trim(),
      kind: best?.kind ?? 'none',
      contrast: best === undefined ? 1 : Math.round(best.contrast * 100) / 100,
    };
  }, unfocusedBorder);
}

/**
 * The border colour of every element of the page's body, by its place among
 * them, to compare with once the focus has moved (`Stop.index`).
 */
export function borderColoursOfPage(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.body.querySelectorAll('*'),
      (element) => getComputedStyle(element).borderTopColor,
    ),
  );
}

export interface RunningAnimation {
  kind: string;
  name: string;
  /** How long one round lasts (ms) and how many rounds it runs. */
  duration: number;
  iterations: number;
}

/** The animations and transitions in progress right now. */
export function runningAnimations(page: Page): Promise<RunningAnimation[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => {
        const timing = animation.effect?.getComputedTiming();
        const duration = timing?.duration;
        return {
          kind: animation.constructor.name,
          name:
            animation instanceof CSSAnimation
              ? animation.animationName
              : animation instanceof CSSTransition
                ? animation.transitionProperty
                : animation.id,
          duration: typeof duration === 'number' ? duration : 0,
          iterations: timing?.iterations ?? 1,
        };
      }),
  );
}

/**
 * Waits until what is fading in or sliding in has stopped moving: a colour
 * measured on a popover that is half transparent is not the colour it ends up
 * with, and an audit would blame it. Animations that never end (a spinner)
 * are left alone.
 */
export async function animationsDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().iterations !== Infinity,
      );
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
}

export interface Landmarks {
  /** `main` landmarks in the accessibility tree. */
  main: number;
  /** `navigation` landmarks (a `nav`, or `role="navigation"`) in the accessibility tree. */
  navigation: number;
  /** `complementary` landmarks (an `aside`): the rail of a computer, which a phone does not show. */
  complementary: number;
  /** Level 1 headings in the accessibility tree. */
  h1: number;
}

/**
 * The landmarks and the page heading as assistive technology sees them: an
 * element that is hidden or `aria-hidden` (the desktop copy of the mobile
 * header, the panel a phone does not show) does not count.
 */
export async function landmarksOf(page: Page): Promise<Landmarks> {
  return {
    main: await page.getByRole('main').count(),
    navigation: await page.getByRole('navigation').count(),
    complementary: await page.getByRole('complementary').count(),
    h1: await page.getByRole('heading', { level: 1 }).count(),
  };
}

export interface Violation {
  id: string;
  nodes: Array<{ html: string; failureSummary?: string | undefined }>;
}

/**
 * Rules of axe that the component library breaks in a state of its own, and
 * that this change does not mend (they are the Known gaps of the change). An
 * audit of such a state names the rule it lets through; everything else of the
 * audit stands.
 */
export const LIBRARY_GAPS = {
  /**
   * A scroller that holds nothing the Tab key reaches: a Radix menu moves its
   * focus with the arrow keys (roving tabindex), so a menu taller than a window
   * that is 390 px high scrolls and fails the rule.
   */
  scrollableRegion: 'scrollable-region-focusable',
} as const;

/** The violations of an audit, without the rules the library is known to break in the state audited. */
export function withoutGaps<V extends { id: string }>(
  violations: readonly V[],
  gaps: readonly string[],
): V[] {
  return violations.filter(({ id }) => !gaps.includes(id));
}

/** The violations of an axe audit as a failure message reads them: the rule, the nodes and what is wrong with each (colours included). */
export function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map(
      ({ id, nodes }) =>
        `${id}\n${nodes
          .slice(0, 5)
          .map(
            (node) =>
              `  ${node.html.slice(0, 220)}\n  ${(node.failureSummary ?? '').replaceAll('\n', '\n  ')}`,
          )
          .join('\n')}`,
    )
    .join('\n');
}
