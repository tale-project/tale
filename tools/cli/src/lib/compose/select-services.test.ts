import { describe, expect, test } from 'bun:test';

import { selectDefaultServices } from './select-services';

const ALL_RUNNING = () => true;
const NONE_RUNNING = () => false;

describe('selectDefaultServices', () => {
  test('always rolls platform + the always-roll tier', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
    });
    expect(sel.rotatable).toEqual(['platform']);
    // The sandbox and backend tiers are single containers (blue-green
    // dropped) and roll in place through the stateful compose.
    expect(sel.stateful).toEqual([
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'backend-api',
      'backend-worker',
    ]);
  });

  test('running db/proxy are left untouched without --stop', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
    });
    expect(sel.leftRunning).toEqual(['db', 'object-store', 'proxy']);
    expect(sel.stateful).not.toContain('db');
    expect(sel.stateful).not.toContain('object-store');
    expect(sel.stateful).not.toContain('proxy');
  });

  test('--stop includes db/proxy even when running', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: true,
      isStopGatedRunning: ALL_RUNNING,
    });
    expect(sel.leftRunning).toEqual([]);
    expect(sel.stateful).toEqual([
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'backend-api',
      'backend-worker',
      'db',
      'object-store',
      'proxy',
    ]);
  });

  test('stopped db/proxy are updated without --stop', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: NONE_RUNNING,
    });
    expect(sel.leftRunning).toEqual([]);
    expect(sel.stateful).toContain('db');
    expect(sel.stateful).toContain('proxy');
  });

  test('a partially-running stop-gated tier updates only the stopped one', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: (s) => s === 'db', // db running, proxy stopped
    });
    expect(sel.leftRunning).toEqual(['db']);
    expect(sel.stateful).toContain('proxy');
    expect(sel.stateful).not.toContain('db');
  });

  test('first deploy includes everything regardless of running state', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: true,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
    });
    expect(sel.leftRunning).toEqual([]);
    expect(sel.stateful).toEqual([
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'backend-api',
      'backend-worker',
      'db',
      'object-store',
      'proxy',
    ]);
  });
});

describe('the application backend tier', () => {
  test('always rolls — every stack runs it', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: () => true,
    });
    expect(sel.stateful).toContain('backend-api');
    expect(sel.stateful).toContain('backend-worker');
  });
});
