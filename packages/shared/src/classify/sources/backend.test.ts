import { describe, expect, it } from 'vitest';

import { classifyBackend as c } from './backend.ts';

describe('classifyBackend', () => {
  it('surfaces errors and warnings verbatim', () => {
    expect(c('2026-08-30T00:00:00Z ERROR job failed: boom').kind).toBe('error');
    expect(c('Uncaught TypeError: x is not a function').kind).toBe('error');
    expect(c('[jobs] WARN retrying rag.index_file').kind).toBe('warn');
  });

  it('promotes the boot milestones a developer waits on', () => {
    expect(c('[boot] listening on :3005').kind).toBe('info');
    expect(c('[migrate] migrations applied').kind).toBe('info');
  });

  it('collapses ordinary boot chatter to progress, the rest to noise', () => {
    const progress = c('[jobs] registering queue chat.turn');
    expect(progress.kind).toBe('progress');
    expect(c('served GET /api/app/tasks 200 in 3ms').kind).toBe('noise');
  });
});
