// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { extractSources, SourceCards } from './source-cards';

/**
 * Sources are what the assistant actually LOADED: web_fetch and rag_fetch
 * successes, in call order, deduplicated by target. Search hits and failed
 * calls never become sources — the cards must not claim reading that did
 * not happen. Beyond three, the strip folds behind "Show all N sources";
 * document chips are buttons (the in-app preview) only when an org context
 * exists.
 */

function result(tool: string, output: unknown): MessagePart {
  return {
    type: 'tool-result',
    callId: `c-${tool}-${JSON.stringify(output).length}`,
    capabilityId: tool,
    output,
    structured: true,
  };
}

describe('extractSources', () => {
  it('reads fetched pages and documents, in call order', () => {
    const sources = extractSources([
      result('web_fetch', {
        status: 'ok',
        url: 'https://example.com/a',
        title: 'Example Domain',
      }),
      result('rag_fetch', {
        status: 'ok',
        kind: 'document',
        ref: 'file_1',
        filename: 'report.pdf',
      }),
      result('rag_fetch', {
        status: 'ok',
        kind: 'web-page',
        url: 'https://docs.example.com/page',
        title: 'Docs',
      }),
    ]);
    expect(sources).toEqual([
      {
        kind: 'web',
        label: 'Example Domain',
        url: 'https://example.com/a',
        domain: 'example.com',
      },
      { kind: 'document', label: 'report.pdf', fileId: 'file_1' },
      {
        kind: 'web',
        label: 'Docs',
        url: 'https://docs.example.com/page',
        domain: 'docs.example.com',
      },
    ]);
  });

  it('never sources a failure or a bare search', () => {
    const sources = extractSources([
      result('web_fetch', { status: 'error', message: 'nope' }),
      result('rag_search', { status: 'ok', results: [{ url: 'https://x.y' }] }),
    ]);
    expect(sources).toEqual([]);
  });

  it('deduplicates a target fetched twice and falls back to the URL as label', () => {
    const sources = extractSources([
      result('web_fetch', { status: 'ok', url: 'https://example.com' }),
      result('web_fetch', {
        status: 'ok',
        url: 'https://example.com',
        title: 'Example Domain',
      }),
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ label: 'https://example.com' });
  });
});

function webResults(count: number): MessagePart[] {
  return Array.from({ length: count }, (_, index) =>
    result('web_fetch', {
      status: 'ok',
      url: `https://example.com/${index}`,
      title: `Page ${index}`,
    }),
  );
}

describe('SourceCards', () => {
  it('folds cards beyond three behind the "Show all N sources" toggle', async () => {
    const { user } = render(<SourceCards parts={webResults(5)} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
    await user.click(
      screen.getByRole('button', { name: /Show all 5 sources/ }),
    );
    expect(screen.getAllByRole('link')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: /Hide sources/ }));
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows every card without a toggle when three or fewer', () => {
    render(<SourceCards parts={webResults(3)} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('makes a document chip a preview button only under an org context', () => {
    const documentParts = [
      result('rag_fetch', {
        status: 'ok',
        kind: 'document',
        ref: 'file_1',
        filename: 'report.pdf',
      }),
    ];
    const { rerender } = render(
      <SourceCards parts={documentParts} organizationId="org_1" />,
    );
    expect(
      screen.getByRole('button', { name: /report\.pdf/ }),
    ).toBeInTheDocument();

    // A snapshot surface has no org context — the chip stays inert.
    rerender(<SourceCards parts={documentParts} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('enters with the settle fade (opacity-only, reduced-motion safe)', () => {
    const { container } = render(<SourceCards parts={webResults(1)} />);

    expect(container.firstElementChild).toHaveClass('animate-content-in');
  });
});
