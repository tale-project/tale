'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

// CSS properties the mirror must copy from the textarea so its text wraps and
// measures identically. Kebab-case so they copy via get/setProperty without an
// unsafe cast on CSSStyleDeclaration.
const COPIED_STYLE_PROPS = [
  'box-sizing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-indent',
  'word-spacing',
  'word-break',
  'tab-size',
] as const;

export interface TokenRect {
  id: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TokenLayout {
  /**
   * The textarea's box within its positioned ancestor. The overlay layer is
   * sized/placed to match, so token coords are textarea-content-relative.
   */
  layer: { left: number; top: number; width: number; height: number };
  /** Token rects relative to the layer, already adjusted for textarea scroll. */
  tokens: TokenRect[];
}

/**
 * Measure the on-screen rect of every `[N]` token inside a plain `<textarea>`.
 *
 * A textarea exposes no range geometry, so we mirror its text into an
 * off-screen `<div>` that copies the textarea's box + typography, wrap each
 * token in a `<span>`, and read the spans' offsets. Re-measures on value
 * change, textarea scroll, and resize. Returns `null` while inactive or before
 * the first measure. Assumes the textarea has zero padding (the composer
 * does) — non-zero padding would need to be folded into `layer`.
 */
export function useTextareaTokenRects(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  active: boolean,
): TokenLayout | null {
  const [layout, setLayout] = useState<TokenLayout | null>(null);

  useLayoutEffect(() => {
    if (!active || !textareaRef.current) {
      setLayout(null);
      return undefined;
    }
    const textarea = textareaRef.current;
    let mirror: HTMLDivElement | null = null;

    const measure = () => {
      const ta = textareaRef.current;
      if (!ta) return;
      if (!mirror) {
        mirror = document.createElement('div');
        mirror.setAttribute('aria-hidden', 'true');
        const s = mirror.style;
        s.position = 'absolute';
        s.top = '0';
        s.left = '0';
        s.visibility = 'hidden';
        s.pointerEvents = 'none';
        s.whiteSpace = 'pre-wrap';
        s.overflowWrap = 'break-word';
        s.overflow = 'hidden';
        document.body.appendChild(mirror);
      }
      const cs = getComputedStyle(ta);
      for (const prop of COPIED_STYLE_PROPS) {
        mirror.style.setProperty(prop, cs.getPropertyValue(prop));
      }
      // clientWidth is the padding box minus any scrollbar — the wrap width the
      // textarea actually uses. With border-box + the copied padding, the
      // mirror's content area equals the textarea's.
      mirror.style.boxSizing = 'border-box';
      mirror.style.width = `${ta.clientWidth}px`;

      // Rebuild content: text nodes + one <span> per token. textContent only
      // (never innerHTML) — bracket chars are plain text, no escaping concerns.
      // The span covers `[N]` AND its trailing reserve spaces so the chip's
      // measured footprint matches the room reserved for it in the text.
      mirror.textContent = '';
      const spans: HTMLSpanElement[] = [];
      const ids: number[] = [];
      const re = /\[(\d+)\] */g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(value)) !== null) {
        if (match.index > lastIndex) {
          mirror.appendChild(
            document.createTextNode(value.slice(lastIndex, match.index)),
          );
        }
        const span = document.createElement('span');
        span.textContent = match[0];
        mirror.appendChild(span);
        spans.push(span);
        ids.push(Number(match[1]));
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < value.length) {
        mirror.appendChild(document.createTextNode(value.slice(lastIndex)));
      }
      // A trailing newline has no laid-out box without a follower; a zero-width
      // space keeps the final line's geometry honest.
      mirror.appendChild(document.createTextNode('\u200B'));

      const { scrollLeft, scrollTop } = ta;
      const tokens: TokenRect[] = spans.map((span, i) => ({
        id: ids[i],
        left: span.offsetLeft - scrollLeft,
        top: span.offsetTop - scrollTop,
        width: span.offsetWidth,
        height: span.offsetHeight,
      }));

      setLayout({
        layer: {
          left: ta.offsetLeft,
          top: ta.offsetTop,
          width: ta.clientWidth,
          height: ta.clientHeight,
        },
        tokens,
      });
    };

    measure();
    textarea.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    window.addEventListener('resize', measure);

    return () => {
      textarea.removeEventListener('scroll', measure);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      mirror?.remove();
    };
  }, [textareaRef, value, active]);

  return layout;
}
