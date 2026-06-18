import { describe, expect, it } from 'vitest';

import { classifyVite as c } from './vite.ts';

describe('classifyVite', () => {
  it('surfaces the ready line, the built line, and the Local URL', () => {
    expect(c('  VITE v7.0.0  ready in 1234 ms').kind).toBe('info');
    expect(c('  VITE v7.0.0  ready in 1234 ms').text).toBe(
      'vite ready (1234 ms)',
    );
    expect(c('✓ built in 1.23s').text).toBe('built (1.23s)');
    const url = c('  ➜  Local:   http://localhost:3000/');
    expect(url.kind).toBe('info');
    expect(url.text).toBe('http://localhost:3000/');
  });

  it('collapses HMR churn and the network/help lines to noise', () => {
    expect(c('[vite] hmr update /app/x.tsx').kind).toBe('noise');
    expect(c('[vite] page reload src/main.tsx').kind).toBe('noise');
    expect(c('[vite] hot updated: /app/y.css').kind).toBe('noise');
    expect(c('  ➜  Network: http://192.168.1.2:3000/').kind).toBe('noise');
    expect(c('  press h + enter to show help').kind).toBe('noise');
  });

  it('surfaces transform / build / port errors and strips the X [ERROR] prefix', () => {
    const t = c('X [ERROR] Transform failed with 1 error:');
    expect(t.kind).toBe('error');
    expect(t.text).toBe('Transform failed with 1 error:');
    expect(c('Internal server error').kind).toBe('error');
    expect(c('Pre-transform error: bad import').kind).toBe('error');
    expect(c('Build failed in 200ms').kind).toBe('error');
    expect(c('Port 3000 is already in use').kind).toBe('error');
    expect(c('  Error: Cannot find module x').kind).toBe('error');
  });

  it('falls through to noise and tags the vite source', () => {
    expect(c('whatever').kind).toBe('noise');
    expect(c('whatever').source).toBe('vite');
  });
});
