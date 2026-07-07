import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const warnMock = mock();

mock.module('../../../utils/logger', () => ({
  info: mock(),
  warn: warnMock,
  error: mock(),
  debug: mock(),
  success: mock(),
  step: mock(),
  notice: mock(),
  containerLog: mock(),
  blank: mock(),
  header: mock(),
  table: mock(),
  bannerText: mock(() => ''),
}));

import { setProjectId } from '../../project/project-context';
import { generateDevCompose } from './generate-dev-compose';

setProjectId('testproj');

describe('generateDevCompose — empty-workspace warning (R31-P2-b)', () => {
  let projectDir: string;

  beforeEach(() => {
    warnMock.mockReset();
    projectDir = mkdtempSync(join(tmpdir(), 'tale-dev-compose-'));
  });

  test('warns exactly once when no org config dirs exist', () => {
    try {
      generateDevCompose(
        { version: 'latest', registry: 'ghcr.io/tale-project/tale' },
        'localhost',
        443,
        { projectDir },
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
    const orgWarnings = warnMock.mock.calls.filter((c) =>
      String(c[0]).includes('No org config found'),
    );
    // Both the convex and the platform service resolve host mounts from the
    // same discovery; an empty workspace must not repeat the warning per
    // service.
    expect(orgWarnings).toHaveLength(1);
  });
});
