import { describe, expect, test } from 'bun:test';

import { selectDefaultServices } from './select-services';

const ALL_RUNNING = () => true;
const NONE_RUNNING = () => false;

describe('selectDefaultServices', () => {
  test('rolls the whole application tier as a colour, plus the always-roll tier', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: ALL_RUNNING,
    });
    // The application tier is stateless and deploys as ONE colour: the web
    // tier and both backend roles rotate together, never independently.
    expect(sel.rotatable).toEqual([
      'platform',
      'backend-api',
      'backend-worker',
    ]);
    // The sandbox tier stays a singleton — it holds docker.sock, the session
    // directory and the gateway volume — and rolls in place.
    expect(sel.stateful).toEqual([
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
      'db',
      'object-store',
      'proxy',
    ]);
  });
});

describe('the application backend tier', () => {
  // It ships the SAME image as the web tier and shares its wire contracts,
  // so the two must never version-skew: they rotate in one colour, and the
  // stateful compose must not carry them at all — a copy there would roll in
  // place beside the colour that already owns them.
  test('rotates with the colour, never through the stateful compose', () => {
    const sel = selectDefaultServices({
      isFirstDeploy: false,
      stop: false,
      isStopGatedRunning: () => true,
    });
    expect(sel.rotatable).toContain('backend-api');
    expect(sel.rotatable).toContain('backend-worker');
    expect(sel.stateful).not.toContain('backend-api');
    expect(sel.stateful).not.toContain('backend-worker');
  });
});
