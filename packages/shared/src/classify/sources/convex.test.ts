import { describe, expect, it } from 'vitest';

import { classifyConvex as c } from './convex.ts';

describe('classifyConvex', () => {
  it('gates readiness on "N functions ready", with and without a duration', () => {
    const withTime = c('✔ 318 functions ready! (12.34s)');
    expect(withTime.kind).toBe('info');
    expect(withTime.text).toBe('318 functions ready (12.34s)');
    const noTime = c('✔ 5 functions ready');
    expect(noTime.text).toBe('5 functions ready');
  });

  it('surfaces push / type errors and strips the leading glyph', () => {
    expect(c('✖ chat.ts:42 Type error: foo').kind).toBe('error');
    expect(c('✖ chat.ts:42 Type error: foo').text).toBe(
      'chat.ts:42 Type error: foo',
    );
    expect(c('✗ boom').kind).toBe('error');
    expect(c('  ✘ boom').kind).toBe('error');
    expect(c('Uncaught Error: nope').kind).toBe('error');
    expect(c('Error: nope').kind).toBe('error');
  });

  it('surfaces schema/index/provision milestones as info', () => {
    expect(c('✔ Schema validation complete').text).toBe(
      'Schema validation complete',
    );
    expect(c('✔ Added index by_org on tasks').kind).toBe('info');
    expect(c('✔ Provisioned 3 components').kind).toBe('info');
  });

  it('collapses the push/bundle churn to progress', () => {
    expect(c('Preparing Convex functions...').kind).toBe('progress');
    expect(c('Preparing Convex functions...').text).toBe('pushing functions');
    expect(c('Pushing code to the deployment').kind).toBe('progress');
    expect(c('Bundling modules').kind).toBe('progress');
    expect(c('Downloading the convex binary').kind).toBe('progress');
  });

  it('hides the idle watcher line (regression: must stay noise)', () => {
    expect(c('Watching for file changes...').kind).toBe('noise');
  });

  it('falls through to noise and tags the convex source', () => {
    expect(c('some unrelated chatter').kind).toBe('noise');
    expect(c('anything').source).toBe('convex');
  });
});
