import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail: the chat UI must never subtract a SERVER epoch timestamp
 * (`generationStartTime`, a message `_creationTime`, `startedAt`) from a CLIENT
 * `Date.now()`. That mix is ~0 on localhost but seconds in production — the
 * "Thinking · Ns" timer rewind and the streaming-reply-above-user mis-order.
 * Every "now" in these files must come from `use-clock-offset`
 * (`clientEpochNow` / `serverEpochNow` / `toClientEpoch`), whose module is the
 * ONLY sanctioned raw-clock site.
 *
 * Pure source-walk (no DOM). This IS the guard: the pinned oxlint build ships
 * neither `no-restricted-syntax` nor `no-restricted-properties`, so a config
 * rule can't express "no Date.now() in these files" — a source-walk in the test
 * gate does. Mirrors `settings/governance/components/skeleton-conventions.test.ts`.
 */
const PLATFORM_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

const read = (rel: string): string =>
  readFileSync(resolve(PLATFORM_ROOT, rel), 'utf8');

/** Files that render live timers / relative-time from server timestamps. */
const GUARDED_FILES = [
  'app/features/chat/components/thought-timeline/use-thinking-timer.ts',
  'app/features/chat/components/thought-timeline/thinking-indicator.tsx',
  'app/features/chat/components/thought-timeline/message-thought-header.tsx',
  'app/features/chat/components/chat-interface.tsx',
  'app/features/chat/components/workflow-run-approval-card.tsx',
  'app/features/chat/hooks/use-merged-chat-items.ts',
  'app/hooks/use-relative-now.ts',
  'lib/utils/format/relative-time.ts',
];

describe('chat clock-safety', () => {
  it.each(GUARDED_FILES)(
    '%s never calls Date.now() directly (use use-clock-offset)',
    (rel) => {
      expect(read(rel)).not.toMatch(/\bDate\.now\s*\(/);
    },
  );

  it('the message sort orders by (order, stepOrder), not a _creationTime clock fallback', () => {
    const src = read('app/features/chat/hooks/use-merged-chat-items.ts');
    expect(src).toContain('stepOrder');
    // The old clock-mixing comparator key.
    expect(src).not.toMatch(/_creationTime\s*\?\?/);
  });

  it('the thinking timer reads "now" through the clock authority', () => {
    const src = read(
      'app/features/chat/components/thought-timeline/use-thinking-timer.ts',
    );
    expect(src).toContain('clientEpochNow');
  });

  it('use-clock-offset remains the sanctioned raw-clock home', () => {
    // The offset module is intentionally OUT of the guarded set and IS allowed
    // to read the wall clock — that is where the offset is measured.
    expect(read('app/hooks/use-clock-offset.tsx')).toMatch(/\bDate\.now\s*\(/);
  });
});
