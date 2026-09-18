// @vitest-environment jsdom
/**
 * Regression: previously revealed `.stream-seg` spans must keep their DOM
 * nodes as the reveal position advances. The mount fade only runs when an
 * element is INSERTED — if a reveal step remounts already-revealed spans,
 * the whole sentence re-fades from 0% on every step (the "text does not
 * stay revealed" bug). Root cause was the cursor wrapper inlining
 * `{children}` next to the cursor: react-markdown passes a SINGLE element
 * for one child and an ARRAY for several, so that slot flipped
 * element→array between renders and React remounted everything inside.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IncrementalMarkdown } from './incremental-markdown';

const TEXT =
  'Hey! 👋\n\nEs sieht so aus, als hätte deine Nachricht abgebrochen – du ' +
  'hast geschrieben "The issue is", aber dann ist nichts mehr gekommen.\n\n' +
  'Kannst du mir sagen, welches Problem du hast?';

function firstParagraphTwoSpan(container: HTMLElement): Element | undefined {
  return [...container.querySelectorAll('.stream-seg')].find((s) =>
    s.textContent?.startsWith('Es sieht'),
  );
}

describe('streaming reveal DOM identity', () => {
  it.each([true, false])(
    'keeps revealed segment spans mounted across reveal steps (showCursor=%s)',
    (showCursor) => {
      // Three reveal positions inside paragraph 2: one span → two spans →
      // paragraph complete. The first span must stay the SAME DOM node.
      const positions = [
        TEXT.indexOf('als hätte'),
        TEXT.indexOf(', aber') + 2,
        TEXT.indexOf('gekommen.') + 'gekommen.'.length,
      ];
      const { container, rerender } = render(
        <IncrementalMarkdown
          content={TEXT}
          revealPosition={positions[0]}
          showCursor={showCursor}
        />,
      );
      let prev = firstParagraphTwoSpan(container);
      expect(prev).toBeDefined();

      for (const pos of positions.slice(1)) {
        rerender(
          <IncrementalMarkdown
            content={TEXT}
            revealPosition={pos}
            showCursor={showCursor}
          />,
        );
        const current = firstParagraphTwoSpan(container);
        expect(current).toBe(prev);
        prev = current;
      }
    },
  );
});
