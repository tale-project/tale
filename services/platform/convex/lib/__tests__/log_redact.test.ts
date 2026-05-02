import { describe, it, expect } from 'vitest';

import { summarizeForLog } from '../log_redact';

describe('summarizeForLog', () => {
  it('returns a 12-char hex sha256 prefix and the byte length', () => {
    const result = summarizeForLog('hello world');
    expect(result.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(result.len).toBe('hello world'.length);
  });

  it('does not include the original plaintext in the returned object', () => {
    const secret = 'USER_MEMORY: ssn=123-45-6789';
    const result = summarizeForLog(secret);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('USER_MEMORY');
  });

  it('is deterministic for identical inputs', () => {
    const a = summarizeForLog('the quick brown fox');
    const b = summarizeForLog('the quick brown fox');
    expect(a.sha256).toBe(b.sha256);
    expect(a.len).toBe(b.len);
  });

  it('produces different digests for different inputs', () => {
    const a = summarizeForLog('alpha');
    const b = summarizeForLog('beta');
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('handles non-string payloads via JSON.stringify', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi' },
    ];
    const result = summarizeForLog(messages);
    expect(result.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(result.len).toBe(JSON.stringify(messages).length);
    // No original content leaks
    expect(JSON.stringify(result)).not.toContain('hello');
    expect(JSON.stringify(result)).not.toContain('hi');
  });
});
