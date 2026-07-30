import { describe, expect, it } from 'vitest';

import type { MessagePart } from '../types';
import { extractSources } from './source-cards';

/**
 * Sources are what the assistant actually LOADED: web_fetch and rag_fetch
 * successes, in call order, deduplicated by target. Search hits and failed
 * calls never become sources — the cards must not claim reading that did
 * not happen.
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
      { kind: 'document', label: 'report.pdf' },
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
