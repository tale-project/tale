import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

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
    // Both the backend tier and the platform service resolve host mounts
    // from the same discovery; an empty workspace must not repeat the warning
    // per service.
    expect(orgWarnings).toHaveLength(1);
  });
});

interface ParsedCompose {
  services: Record<
    string,
    {
      depends_on?: string[] | Record<string, { condition: string }>;
      volumes?: string[];
    }
  >;
  volumes: Record<string, unknown>;
}

function renderDevCompose(): ParsedCompose {
  const projectDir = mkdtempSync(join(tmpdir(), 'tale-dev-compose-'));
  try {
    return parse(
      generateDevCompose(
        { version: 'latest', registry: 'ghcr.io/tale-project/tale' },
        'localhost',
        443,
        { projectDir },
      ),
    ) as ParsedCompose;
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

describe('generateDevCompose — the stack is self-consistent', () => {
  // A `depends_on` naming a service the file does not define is a compose
  // file docker refuses outright (`service "x" depends on undefined service
  // "y"`), so the whole `tale dev` stack fails to start. The backend tier
  // depends on the blob store it seeds at boot; the store must be IN the
  // dev stack, not only in the stateful one.
  test('every depends_on target is a service the dev stack defines', () => {
    const { services } = renderDevCompose();
    for (const [name, service] of Object.entries(services)) {
      const targets = Array.isArray(service.depends_on)
        ? service.depends_on
        : Object.keys(service.depends_on ?? {});
      for (const target of targets) {
        expect(
          Object.keys(services),
          `${name} depends on ${target}, which the dev compose does not define`,
        ).toContain(target);
      }
    }
  });

  test('runs the object store the backend tier depends on, on its dev volume', () => {
    const { services, volumes } = renderDevCompose();
    expect(services['object-store']).toBeDefined();
    expect(services['backend-api']?.depends_on).toHaveProperty('object-store');
    expect(services['backend-worker']?.depends_on).toHaveProperty(
      'object-store',
    );
    // The named volume the service mounts is declared (and pre-created by
    // `tale dev` from DEV_VOLUME_NAMES).
    expect(services['object-store']?.volumes).toContain(
      'object-store-data:/data',
    );
    expect(volumes).toHaveProperty('object-store-data');
  });
});
