import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { IncrementalMarkdown } from '../incremental-markdown';

// ============================================================================
// HELPERS
// ============================================================================

/** Count visible cursor elements (useLayoutEffect hides duplicates via display:none) */
function countCursors(container: HTMLElement) {
  const all = container.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
  let visible = 0;
  for (const el of all) {
    if (el.style.display !== 'none') visible++;
  }
  return visible;
}

// ============================================================================
// DOUBLE CURSOR PREVENTION
// ============================================================================

describe('IncrementalMarkdown — cursor injection', () => {
  it('renders exactly one cursor for a single paragraph', () => {
    const content = 'Hello world';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders exactly one cursor for a loose list (no double cursor on li+p)', () => {
    // Loose list: blank line between items makes remark wrap content in <p>
    const content = '- Item 1\n\n- Item 2\n\n- Item 3';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor for a tight list', () => {
    const content = '- Item 1\n- Item 2\n- Item 3';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor for content with headings and paragraphs', () => {
    const content = '## Title\n\nSome text here';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders no cursor when showCursor is false', () => {
    const content = 'Hello world';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor={false}
      />,
    );

    expect(countCursors(container)).toBe(0);
  });

  it('renders exactly one cursor for a table', () => {
    const content = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders no cursor for a fenced code block (cursor not injected into pre)', () => {
    const content = '```yaml\nlegal_review_date: "2025-03-14"\n```';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(0);
  });

  it('renders no cursor for an incomplete code block (cursor not injected into pre)', () => {
    const content = '```yaml\nline1: value\nline2: value';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(0);
  });

  it('renders cursor in paragraph when paragraph follows a code block', () => {
    const content = '```js\nconst x = 1;\n```\n\nSome text after';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders no cursor when paragraph precedes a code block (code block is last)', () => {
    const content = 'Some text\n\n```js\nconst x = 1;\n```';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(0);
  });
});

// ============================================================================
// MID-STREAM CURSOR (partial reveal)
// ============================================================================

describe('IncrementalMarkdown — cursor during partial reveal (mid-stream)', () => {
  it('renders cursor when reveal is mid-paragraph', () => {
    const content = 'Hello world, this is streaming text.';
    const { container } = render(
      <IncrementalMarkdown content={content} revealPosition={10} showCursor />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders cursor when reveal is mid-way through multi-paragraph content', () => {
    const content = 'First paragraph.\n\nSecond paragraph being typed.';

    const { container } = render(
      <IncrementalMarkdown content={content} revealPosition={28} showCursor />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders cursor mid-list item', () => {
    const content = '- First item\n- Second item being typed';
    const { container } = render(
      <IncrementalMarkdown content={content} revealPosition={20} showCursor />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders cursor mid-heading', () => {
    const content = '## This heading is still being typ';
    const { container } = render(
      <IncrementalMarkdown content={content} revealPosition={20} showCursor />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor across multiple reveals of the same content', () => {
    const content = 'Streaming paragraph content here.';

    const { container, rerender } = render(
      <IncrementalMarkdown content={content} revealPosition={5} showCursor />,
    );
    expect(countCursors(container)).toBe(1);

    rerender(
      <IncrementalMarkdown content={content} revealPosition={15} showCursor />,
    );
    expect(countCursors(container)).toBe(1);

    rerender(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    expect(countCursors(container)).toBe(1);
  });
});

// ============================================================================
// SPLIT STABILITY (scroll jump prevention)
// ============================================================================

describe('IncrementalMarkdown — DOM stability on cursor toggle', () => {
  it('does not change DOM structure when showCursor changes', () => {
    const content = 'Paragraph one.\n\nParagraph two.';

    const { container, rerender } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );

    const withCursorHTML = container.innerHTML;
    expect(countCursors(container)).toBe(1);

    rerender(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor={false}
      />,
    );

    expect(countCursors(container)).toBe(0);

    const withoutCursorHTML = container.innerHTML;
    const cursorSpanPattern =
      /<span class="[^"]*animate-cursor-blink[^"]*"[^>]*aria-hidden="true"><\/span>/;
    const normalizedWithCursor = withCursorHTML.replace(cursorSpanPattern, '');
    expect(normalizedWithCursor).toBe(withoutCursorHTML);
  });
});

// ============================================================================
// EMPTY MARKER ELEMENTS — cursor must NOT land in elements with no rendered text
// ============================================================================

describe('IncrementalMarkdown — cursor not in empty marker elements', () => {
  it('omits cursor inside empty <li> from trailing list marker', () => {
    // Stream paused at `\n- ` — empty <li> rendered but no content yet
    const content = 'foo\n- ';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    const items = container.querySelectorAll('li');
    for (const li of items) {
      if (!li.textContent?.trim()) {
        expect(li.querySelector('.animate-cursor-blink')).toBeNull();
      }
    }
  });

  it('omits cursor inside empty <blockquote> from trailing > marker', () => {
    const content = 'text\n\n> ';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    const bq = container.querySelector('blockquote');
    if (bq && !bq.textContent?.trim()) {
      expect(bq.querySelector('.animate-cursor-blink')).toBeNull();
    }
  });

  it('omits cursor inside empty heading from trailing ## marker', () => {
    const content = 'text\n\n## ';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    const h2 = container.querySelector('h2');
    if (h2 && !h2.textContent?.trim()) {
      expect(h2.querySelector('.animate-cursor-blink')).toBeNull();
    }
  });

  it('does not place cursor in trailing empty <li> for `- one\\n- two\\n- `', () => {
    // Mid-stream pause at the third bullet's marker. The user's complaint was
    // a "stuck cursor" inside that empty bullet. After the fix the cursor
    // either lands in a previous bullet or briefly disappears — both are
    // acceptable; the bug we're fixing is "cursor inside the empty bullet".
    const content = '- one\n- two\n- ';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    const items = container.querySelectorAll('li');
    for (const li of items) {
      if (!li.textContent?.trim()) {
        expect(li.querySelector('.animate-cursor-blink')).toBeNull();
      }
    }
    // Any cursor that DOES exist must sit in an element with text content
    const cursor = container.querySelector('.animate-cursor-blink');
    if (cursor) {
      let host: HTMLElement | null = cursor.parentElement;
      while (host && !host.textContent?.replace(/[​-‍﻿]/g, '').trim()) {
        host = host.parentElement;
      }
      expect(host?.textContent?.trim()).not.toBe('');
    }
  });

  it('does not duplicate cursors across an empty trailing element', () => {
    // Regression check: even when the trailing element is empty (no cursor),
    // the rest of the cursor logic must not double-inject elsewhere.
    const content = '- foo\n- ';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        showCursor
      />,
    );
    expect(countCursors(container)).toBeLessThanOrEqual(1);
  });
});
