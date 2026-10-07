// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import ReactMarkdown from 'react-markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { MarkdownContent, markdownComponents } from './markdown-renderer';

afterEach(() => vi.restoreAllMocks());

describe('MarkdownContent', () => {
  it('keeps large content parsed across unrelated parent and styling updates', () => {
    const paragraph = vi.spyOn(markdownComponents, 'p');
    const content = Array.from(
      { length: 300 },
      (_, index) => `Paragraph ${index}.`,
    ).join('\n\n');
    const { container, rerender } = render(
      <MarkdownContent content={content} />,
    );
    expect(paragraph).toHaveBeenCalledTimes(300);
    rerender(<MarkdownContent content={content} className="wider-column" />);
    expect(paragraph).toHaveBeenCalledTimes(300);
    expect(container.firstElementChild).toHaveClass('wider-column');
    rerender(<MarkdownContent content={`${content}\n\nFinal paragraph.`} />);
    expect(paragraph).toHaveBeenCalledTimes(601);
    expect(container.textContent).toContain('Final paragraph.');
  });
});

describe('markdownComponents', () => {
  it('lets lists inherit the answer’s text colour', () => {
    // The shared map draws lists in the muted docs-prose tone; in an answer
    // whose paragraphs are full contrast that read as a de-emphasised aside.
    const { container } = render(
      <ReactMarkdown components={markdownComponents}>
        {'Intro\n\n- one\n- two\n\n1. first\n2. second'}
      </ReactMarkdown>,
    );
    const lists = container.querySelectorAll('ul, ol');
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list.className).not.toContain('text-fg-muted');
    }
  });
});
