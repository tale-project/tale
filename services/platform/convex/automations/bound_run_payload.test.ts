import { describe, expect, it } from 'vitest';

import type { NodeTrace } from '../../lib/engine/core/types';
import {
  boundCheckpointTrace,
  boundNodeTrace,
  boundRunTrace,
  MAX_RUN_DETAIL_CHARS,
  MAX_TRACE_FIELD_CHARS,
  truncateRunDetail,
} from './bound_run_payload';
import type { NodeCheckpoint } from './checkpoints';

const entry = (over: Partial<NodeTrace> = {}): NodeTrace => ({
  node: 'fetch',
  type: 'imap-smtp.list_messages',
  status: 'ok',
  ...over,
});

describe('truncateRunDetail', () => {
  it('leaves a normal failure reason untouched', () => {
    const detail = 'IMAP host is not configured.';
    expect(truncateRunDetail(detail)).toBe(detail);
  });

  it('passes undefined through so an absent detail stays absent', () => {
    expect(truncateRunDetail(undefined)).toBeUndefined();
  });

  it('caps a 66 KB engine-interpolated reason inside the limit', () => {
    // execute/index.ts:357 interpolates JSON.stringify(resolved) into the message.
    const detail = `resolved input does not match the schema. Resolved input was: ${'{"body":"…"},'.repeat(6000)}`;
    expect(detail.length).toBeGreaterThan(66_000);

    const result = truncateRunDetail(detail);

    // Hard bound: the marker is budgeted INSIDE the cap, not appended on top.
    expect(result.length).toBe(MAX_RUN_DETAIL_CHARS);
    expect(result).toContain(`truncated from ${detail.length} characters`);
  });

  it('re-capping an already-capped detail is a no-op', () => {
    const once = truncateRunDetail('x'.repeat(50_000));
    expect(truncateRunDetail(once)).toBe(once);
  });
});

describe('boundNodeTrace', () => {
  it('keeps a small input and output as they are', () => {
    const t = entry({ input: { limit: 25 }, output: { count: 2 } });
    expect(boundNodeTrace(t)).toEqual(t);
  });

  it('preserves the identity fields', () => {
    const bounded = boundNodeTrace(entry({ ms: 12, note: 'skipped' }));
    expect(bounded.node).toBe('fetch');
    expect(bounded.type).toBe('imap-smtp.list_messages');
    expect(bounded.status).toBe('ok');
    expect(bounded.ms).toBe(12);
    expect(bounded.note).toBe('skipped');
  });

  it('replaces an output past the hard ceiling with a marker naming the size', () => {
    // A github.get_pull_request_diff forEach output: many large diffs.
    const output = Array.from({ length: 40 }, (_, i) => ({
      pull: i,
      diff: 'x'.repeat(3000),
    }));

    const bounded = boundNodeTrace(entry({ output }));

    expect(JSON.stringify(bounded.output).length).toBeLessThan(
      MAX_TRACE_FIELD_CHARS,
    );
    expect(bounded.output).toMatchObject({ __truncated: true });
  });

  it('shape-bounds a large-but-tolerable value instead of dropping it', () => {
    const bounded = boundNodeTrace(
      entry({ input: { body: 'y'.repeat(9000) } }),
    );

    // Kept as a string with a count marker — not replaced wholesale.
    const input = bounded.input as { body: string };
    expect(typeof input.body).toBe('string');
    expect(input.body).toContain('chars)');
  });

  it('caps a per-node error string', () => {
    const bounded = boundNodeTrace(entry({ error: 'e'.repeat(80_000) }));
    expect(bounded.error?.length).toBe(MAX_RUN_DETAIL_CHARS);
  });

  it('leaves an absent input/output absent rather than adding keys', () => {
    const bounded = boundNodeTrace(entry());
    expect('input' in bounded).toBe(false);
    expect('output' in bounded).toBe(false);
  });
});

describe('boundRunTrace', () => {
  it('bounds every entry and preserves execution order', () => {
    const trace = [
      entry({ node: 'a', output: { ok: 1 } }),
      entry({ node: 'b', output: 'z'.repeat(200_000) }),
      entry({ node: 'c' }),
    ];

    const bounded = boundRunTrace(trace);

    expect(bounded.map((e) => e.node)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(bounded).length).toBeLessThan(
      3 * MAX_TRACE_FIELD_CHARS,
    );
  });
});

describe('boundCheckpointTrace', () => {
  /**
   * The load-bearing guarantee: `outputsFrom()` builds the executor's scope
   * from `checkpoint.output`, so bounding it would change execution, not the
   * log. And `effects` is the audit trail of real side effects.
   */
  it('never touches the checkpoint output — it feeds the executor scope', () => {
    const output = {
      messages: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        body: 'b'.repeat(2000),
      })),
    };
    const checkpoint: NodeCheckpoint = {
      status: 'ok',
      output,
      trace: entry({ output }),
      effects: [],
    };

    const bounded = boundCheckpointTrace(checkpoint);

    expect(bounded.output).toBe(output);
  });

  it('never touches effects — that is the side-effect audit trail', () => {
    const effects = [
      {
        node: 'send',
        connector: 'imap-smtp',
        input: { text: 'q'.repeat(60_000) },
      },
    ];
    const checkpoint: NodeCheckpoint = {
      status: 'ok',
      output: null,
      trace: entry(),
      effects,
    };

    expect(boundCheckpointTrace(checkpoint).effects).toBe(effects);
  });

  it('does bound the nested trace', () => {
    const checkpoint: NodeCheckpoint = {
      status: 'ok',
      output: null,
      trace: entry({ output: 'w'.repeat(200_000) }),
      effects: [],
    };

    const bounded = boundCheckpointTrace(checkpoint);

    // A single oversized STRING is shape-bounded — kept, with a count marker —
    // rather than replaced wholesale. The `__truncated` marker is reserved for
    // values shape bounding cannot get under the ceiling (many large items).
    expect(typeof bounded.trace.output).toBe('string');
    expect(bounded.trace.output as string).toContain('(+195904 chars)');
    expect(JSON.stringify(bounded.trace.output).length).toBeLessThan(
      MAX_TRACE_FIELD_CHARS,
    );
  });
});
