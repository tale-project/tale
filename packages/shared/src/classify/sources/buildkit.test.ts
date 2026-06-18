import { describe, expect, it } from 'vitest';

import { classifyBuildKit as c } from './buildkit.ts';

describe('classifyBuildKit', () => {
  it('marks a build step as progress with a clean label', () => {
    const r = c('#5 [stage-1 3/9] RUN bun install');
    expect(r.kind).toBe('progress');
    expect(r.text).toBe('building stage-1 3/9');
    expect(r.status?.phase).toBe('build');
  });

  it('marks DONE / CACHED / export lines as progress', () => {
    expect(c('#5 DONE 1.2s').kind).toBe('progress');
    expect(c('#5 CACHED').kind).toBe('progress');
    expect(c('#12 exporting to image').kind).toBe('progress');
    expect(c('#12 writing image sha256:deadbeef').kind).toBe('progress');
  });

  it('surfaces a solve failure and the error frame as error', () => {
    expect(c('ERROR: failed to solve: process did not complete').kind).toBe(
      'error',
    );
    expect(c('failed to solve: rpc error').kind).toBe('error');
    expect(c('------').kind).toBe('error');
  });

  it('treats a buildx blob flake as a rerunnable warning', () => {
    expect(c('error: blob sha256:abc not found').kind).toBe('warn');
    expect(c('buildx failed with: exit code 1').kind).toBe('warn');
  });

  it('treats per-step command output as noise', () => {
    expect(c('#5 0.234 Resolving dependencies').kind).toBe('noise');
    expect(c('unrelated chatter').kind).toBe('noise');
  });

  it('tags every line with the buildkit source', () => {
    expect(c('#5 DONE 1.2s').source).toBe('buildkit');
  });
});
