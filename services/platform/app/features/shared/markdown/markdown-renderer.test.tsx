// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { markdownComponents } from './markdown-renderer';

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
