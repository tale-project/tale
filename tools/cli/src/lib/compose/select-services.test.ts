import { describe, expect, test } from 'bun:test';

import { selectDefaultServices } from './select-services';

const ALL_RUNNING = () => true;
const NONE_RUNNING = () => false;

describe('selectDefaultServices', () => {
  test('always rolls platform + the always-roll tier (convex, sandbox-llm-gateway, sandbox, sandbox-egress)', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
      backendEnabled: false,
    });
    expect(sel.rotatable).toEqual(['platform']);
    // The sandbox tier is a single container (blue-green dropped) and rolls
    // in place through the stateful compose like convex.
    expect(sel.stateful).toEqual([
      'convex',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
    ]);
  });

  test('running db/proxy are left untouched without --stop', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
      backendEnabled: false,
    });
    expect(sel.leftRunning).toEqual(['db', 'proxy']);
    expect(sel.stateful).not.toContain('db');
    expect(sel.stateful).not.toContain('proxy');
  });

  test('--stop includes db/proxy even when running', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: true,
      isStopGatedRunning: ALL_RUNNING,
      backendEnabled: false,
    });
    expect(sel.leftRunning).toEqual([]);
    expect(sel.stateful).toEqual([
      'convex',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'db',
      'proxy',
    ]);
  });

  test('stopped db/proxy are updated without --stop', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: NONE_RUNNING,
      backendEnabled: false,
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
      backendEnabled: false,
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
      backendEnabled: false,
    });
    expect(sel.leftRunning).toEqual([]);
    expect(sel.stateful).toEqual([
      'convex',
      'sandbox-llm-gateway',
      'sandbox',
      'sandbox-egress',
      'db',
      'proxy',
    ]);
  });
});

describe('the Postgres backend tier', () => {
  test('is deployed only on a stack that has cut over', () => {
    const migrated = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: () => true,
      backendEnabled: true,
    });
    expect(migrated.stateful).toContain('backend-api');
    expect(migrated.stateful).toContain('backend-worker');

    const notMigrated = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: () => true,
      backendEnabled: false,
    });
    expect(notMigrated.stateful).not.toContain('backend-api');
    expect(notMigrated.stateful).not.toContain('backend-worker');
    // The 0.4 always-roll tier is untouched either way.
    expect(notMigrated.stateful).toContain('convex');
  });
});
