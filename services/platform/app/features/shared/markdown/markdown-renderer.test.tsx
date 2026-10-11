// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import {
  MarkdownContent,
  MarkdownLinkOverridesContext,
  markdownComponents,
} from './markdown-renderer';

afterEach(() => vi.restoreAllMocks());

const OUTPUT_LINK_OVERRIDES = {
  '/agent/output/task-1/report.md': '/api/app/files/file-1/url',
};

function ActionOverrideMarkdown({
  path,
  onClick,
}: {
  path: string;
  onClick: () => void;
}) {
  const overrides = useMemo(
    () => ({ [path]: { href: path, onClick } }),
    [path, onClick],
  );
  return (
    <MarkdownLinkOverridesContext.Provider value={overrides}>
      <ReactMarkdown components={markdownComponents}>
        {`[report](${path})`}
      </ReactMarkdown>
    </MarkdownLinkOverridesContext.Provider>
  );
}

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
  it('replaces a surface-owned file link with its stored browser URL', () => {
    const path = '/agent/output/task-1/report.md';
    const { container } = render(
      <MarkdownLinkOverridesContext.Provider value={OUTPUT_LINK_OVERRIDES}>
        <ReactMarkdown components={markdownComponents}>
          {`[report](${path})`}
        </ReactMarkdown>
      </MarkdownLinkOverridesContext.Provider>,
    );
    expect(container.querySelector('a')).toHaveAttribute(
      'href',
      '/api/app/files/file-1/url',
    );
  });

  it('runs an action override without navigating', () => {
    const path = '/agent/output/task-1/report.md';
    const onClick = vi.fn();
    const { container } = render(
      <ActionOverrideMarkdown path={path} onClick={onClick} />,
    );
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', path);
    link?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

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
