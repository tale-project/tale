import { describe, expect, it } from 'vitest';

import { readConnectorListPage } from './connector_list_page';

/**
 * The shape `executeConnector` actually returns: the connector's payload
 * (data + pagination) nested under `.result`, alongside envelope metadata.
 * Reading the top level instead is the regression these tests guard against —
 * it silently produced an empty page and made the issue desk show no issues.
 */
const envelope = (
  data: unknown[],
  hasNextPage: boolean,
): Record<string, unknown> => ({
  name: 'github',
  operation: 'list_issues',
  duration: 12,
  version: 1,
  result: {
    success: true,
    operation: 'list_issues',
    count: data.length,
    data,
    pagination: { hasNextPage, nextPageInfo: hasNextPage ? '2' : null },
    timestamp: 0,
  },
});

describe('readConnectorListPage', () => {
  it('unwraps rows + hasNext from the nested `.result` envelope', () => {
    const rows = [{ number: 2117 }, { number: 2116 }, { number: 2096 }];

    expect(readConnectorListPage(envelope(rows, true))).toEqual({
      rows,
      hasNext: true,
    });
  });

  it('reports no next page when the envelope says so', () => {
    expect(readConnectorListPage(envelope([{ number: 1 }], false))).toEqual({
      rows: [{ number: 1 }],
      hasNext: false,
    });
  });

  it('does NOT read the top level — a top-level data/pagination is ignored', () => {
    // The bug shape: data/pagination at the top, nothing under `.result`.
    // Such a result must NOT be mistaken for a flat payload, because the real
    // envelope always carries a `.result` object.
    const out = readConnectorListPage({
      name: 'github',
      operation: 'list_issues',
      result: { success: true, data: [], pagination: { hasNextPage: false } },
      data: [{ number: 99 }],
      pagination: { hasNextPage: true },
    });
    expect(out).toEqual({ rows: [], hasNext: false });
  });

  it('tolerates an already-flat payload (forward-compatible)', () => {
    const out = readConnectorListPage({
      data: [{ number: 7 }],
      pagination: { hasNextPage: true },
    });
    expect(out).toEqual({ rows: [{ number: 7 }], hasNext: true });
  });

  it('degrades to an empty, terminal page on a malformed result', () => {
    expect(readConnectorListPage(null)).toEqual({ rows: [], hasNext: false });
    expect(readConnectorListPage({ result: {} })).toEqual({
      rows: [],
      hasNext: false,
    });
  });
});
