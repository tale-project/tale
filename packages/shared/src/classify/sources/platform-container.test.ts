import { describe, expect, it } from 'vitest';

import { classifyPlatformContainer as c } from './platform-container.ts';

const TS = '[2026-06-18 04:30:00]';

describe('classifyPlatformContainer', () => {
  it('maps timestamped ERROR/FATAL to error, stripping the prefix', () => {
    const e = c(`${TS} ERROR migrations failed`);
    expect(e.kind).toBe('error');
    expect(e.text).toBe('migrations failed');
    expect(c(`${TS} FATAL boot aborted`).kind).toBe('error');
  });

  it('maps timestamped WARN to warn', () => {
    const w = c(`${TS} WARN slow boot detected`);
    expect(w.kind).toBe('warn');
    expect(w.text).toBe('slow boot detected');
  });

  it('surfaces OK milestones as info, collapses routine INFO to noise', () => {
    const ok = c(`${TS} OK applied 3 migrations`);
    expect(ok.kind).toBe('info');
    expect(ok.text).toBe('applied 3 migrations');
    expect(c(`${TS} INFO env normalized`).kind).toBe('noise');
  });

  it('treats Reason: / missing: detail as error', () => {
    expect(c('  Reason: ENCRYPTION_SECRET_HEX unset').kind).toBe('error');
    expect(c('  missing: BETTER_AUTH_SECRET').kind).toBe('error');
  });

  it('treats a leading WARN diagnostic (no timestamp) as warn', () => {
    const w = c('  WARN TextLiveFlusher errors detected in convex logs.');
    expect(w.kind).toBe('warn');
    expect(w.text).toBe('TextLiveFlusher errors detected in convex logs.');
  });

  it('maps the ready banner to a clean info line', () => {
    expect(c('Tale Platform is running!').kind).toBe('info');
    expect(c('Tale Platform is running!').text).toBe('platform running');
  });

  it('strips the compose service prefix before classifying', () => {
    expect(c(`tale-platform-1  | ${TS} ERROR boom`).kind).toBe('error');
  });

  it('defensively scrubs any stray emoji from surfaced text', () => {
    const e = c(`${TS} ERROR ❌ legacy line`);
    expect(e.text).not.toMatch(/❌/);
    expect(e.text).toBe('legacy line');
  });

  it('treats the ═══ section rule and other lines as noise', () => {
    expect(c('═══════════════════').kind).toBe('noise');
    expect(c('routine startup chatter').kind).toBe('noise');
  });

  it('tags every line with the platform-container source', () => {
    expect(c(`${TS} ERROR x`).source).toBe('platform-container');
    expect(c('routine').source).toBe('platform-container');
  });
});
