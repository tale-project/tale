import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { IncrementalMarkdown } from '../incremental-markdown';

// ============================================================================
// HELPERS
// ============================================================================

/** Count cursor elements (the blinking span) in the rendered output */
function countCursors(container: HTMLElement) {
  return container.querySelectorAll('[aria-hidden="true"]').length;
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
        anchorPosition={0}
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
        anchorPosition={0}
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
        anchorPosition={0}
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
        anchorPosition={0}
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
        anchorPosition={0}
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
        anchorPosition={0}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor for a fenced code block', () => {
    const content = '```yaml\nlegal_review_date: "2025-03-14"\n```';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={0}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor for an incomplete code block (still streaming)', () => {
    const content = '```yaml\nline1: value\nline2: value';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={0}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });

  it('renders exactly one cursor when paragraph precedes a code block', () => {
    const content = 'Some text\n\n```js\nconst x = 1;\n```';
    const { container } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={0}
        showCursor
      />,
    );

    expect(countCursors(container)).toBe(1);
  });
});

// ============================================================================
// SPLIT STABILITY (scroll jump prevention)
// ============================================================================

describe('IncrementalMarkdown — split stability on stream end', () => {
  it('does not re-parse stable content when showCursor changes', () => {
    const content = 'Paragraph one.\n\nParagraph two.';
    const anchorPosition = 16; // after "Paragraph one.\n\n"

    // Render with cursor (streaming state)
    const { container, rerender } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={anchorPosition}
        showCursor
      />,
    );

    // Capture the DOM structure with cursor
    const withCursorHTML = container.innerHTML;
    expect(countCursors(container)).toBe(1);

    // Rerender without cursor (stream ended)
    rerender(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={anchorPosition}
        showCursor={false}
      />,
    );

    // Cursor should be gone
    expect(countCursors(container)).toBe(0);

    // The DOM should differ ONLY by the cursor span removal —
    // the stable portion should NOT have been re-parsed with different content
    const withoutCursorHTML = container.innerHTML;
    const cursorSpanPattern =
      /<span class="[^"]*animate-cursor-blink[^"]*"[^>]*aria-hidden="true"><\/span>/;
    const normalizedWithCursor = withCursorHTML.replace(cursorSpanPattern, '');
    expect(normalizedWithCursor).toBe(withoutCursorHTML);
  });

  it('keeps streaming portion rendered (not consolidated) after cursor removal', () => {
    const content = 'First block.\n\nSecond block.';
    const anchorPosition = 14; // after "First block.\n\n"

    const { container, rerender } = render(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={anchorPosition}
        showCursor
      />,
    );

    // The root div should have children from both StableMarkdown and StreamingMarkdown
    const childCountWithCursor =
      container.firstElementChild?.children.length ?? 0;

    rerender(
      <IncrementalMarkdown
        content={content}
        revealPosition={content.length}
        anchorPosition={anchorPosition}
        showCursor={false}
      />,
    );

    // Child count should remain the same (no consolidation into single Markdown)
    const childCountWithoutCursor =
      container.firstElementChild?.children.length ?? 0;
    expect(childCountWithoutCursor).toBe(childCountWithCursor);
  });
});
