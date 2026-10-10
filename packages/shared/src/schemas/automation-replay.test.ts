import { describe, expect, it } from 'vitest';

import {
  appReplayRequestSchema,
  replayRequestSchema,
} from './automation-replay';

describe('replayRequestSchema', () => {
  it('takes each kind with what it needs', () => {
    expect(replayRequestSchema.safeParse({ kind: 'again' }).success).toBe(true);
    expect(
      replayRequestSchema.safeParse({
        kind: 'from',
        from: 'send',
        version: 'deployed',
        mode: 'live',
      }).success,
    ).toBe(true);
    expect(
      replayRequestSchema.safeParse({ kind: 'edited', input: null }).success,
    ).toBe(true);
    expect(
      replayRequestSchema.safeParse({ kind: 'again', version: 4 }).success,
    ).toBe(true);
  });

  it.each([
    [{ kind: 'from' }, 'from'],
    [{ kind: 'again', from: 'send' }, 'from'],
    [{ kind: 'edited' }, 'input'],
    [{ kind: 'again', input: { a: 1 } }, 'input'],
    [{ kind: 'again', version: 0 }, 'version'],
    [{ kind: 'again', mode: 'preview' }, 'mode'],
    [{ kind: 'again', extra: true }, ''],
  ])('refuses %j at %s', (body, path) => {
    const parsed = replayRequestSchema.safeParse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toContain(
      path,
    );
  });

  it('lets the app send a nonce, and nobody else', () => {
    expect(
      appReplayRequestSchema.safeParse({ kind: 'again', requestId: 'r1' })
        .success,
    ).toBe(true);
    expect(
      replayRequestSchema.safeParse({ kind: 'again', requestId: 'r1' }).success,
    ).toBe(false);
  });
});
