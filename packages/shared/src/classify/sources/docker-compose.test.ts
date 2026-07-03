import { describe, expect, it } from 'vitest';

import { classifyDockerCompose as c } from './docker-compose.ts';

describe('classifyDockerCompose', () => {
  it('treats health-check access logs as noise', () => {
    expect(c('"GET /health HTTP/1.1" 200 5').kind).toBe('noise');
    expect(c('"GET /health?ready HTTP/1.1" 200 2').kind).toBe('noise');
  });

  it('collapses image-pull layer churn to progress', () => {
    expect(c('a1b2c3d4e5f6: Pulling fs layer').kind).toBe('progress');
    expect(c('a1b2c3d4e5f6: Downloading [===>   ]  12MB/45MB').kind).toBe(
      'progress',
    );
    expect(c('a1b2c3d4e5f6: Pull complete').kind).toBe('progress');
    expect(c('a1b2c3d4e5f6: Already exists').kind).toBe('progress');
  });

  it('surfaces per-image pull milestones as info, keeping layer churn collapsed', () => {
    expect(c(' db Pulling ').kind).toBe('info');
    expect(c(' db Pulling ').text).toBe('db pulling');
    expect(c(' ✔ platform Pulled ').text).toBe('platform pulled');
    expect(c(' db Pulled \r').text).toBe('db pulled');
    expect(c('a1b2c3d4e5f6: Pulling fs layer').kind).toBe('progress');
  });

  it('relabels each lifecycle verb to a clean lowercased status', () => {
    expect(c(' Container tale-db-1  Started').text).toBe('tale-db-1 started');
    expect(c(' Container tale-db-1  Created').text).toBe('tale-db-1 created');
    expect(c(' Container tale-db-1  Healthy').text).toBe('tale-db-1 healthy');
    expect(c(' Network tale_internal  Created').text).toBe(
      'tale_internal created',
    );
    expect(c(' Container tale-db-1  Started').kind).toBe('info');
  });

  it('tolerates a spinner-glyph prefix on a lifecycle line', () => {
    expect(c(' ⠿ Container tale-db-1  Running').text).toBe('tale-db-1 running');
  });

  it('strips the compose service prefix before classifying', () => {
    expect(c('tale-db-1  | a1b2c3d4e5f6: Extracting').kind).toBe('progress');
  });

  it('surfaces image-status lines as info', () => {
    expect(c('Status: Downloaded newer image for postgres:16').kind).toBe(
      'info',
    );
    expect(c('Status: Image is up to date for redis:7').kind).toBe('info');
  });

  it('surfaces compose warnings', () => {
    expect(c('level=warning msg="orphan containers"').kind).toBe('warn');
    expect(c('WARN[0000] networks.foo: unsupported key').kind).toBe('warn');
  });

  it('surfaces keyword-free failures as error (external-network shape)', () => {
    expect(
      c('network tale-sandbox-net declared as external, but could not be found')
        .kind,
    ).toBe('error');
    expect(c('Error response from daemon: no such image').kind).toBe('error');
  });

  it('is CRLF-tolerant on a lifecycle line', () => {
    expect(c(' Container tale-db-1  Started\r').text).toBe('tale-db-1 started');
  });

  it('falls through to noise for benign output', () => {
    expect(c('some unremarkable line').kind).toBe('noise');
    expect(c('').kind).toBe('noise');
  });

  it('tags every line with the docker-compose source', () => {
    expect(c('anything').source).toBe('docker-compose');
  });
});
