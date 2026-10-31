import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  invalidProjectIdMessage,
  isValidProjectId,
} from './generate-project-id';
import {
  getProjectId,
  resolveOrAssignProjectContext,
  resolveProjectContext,
} from './project-context';

/** A project from before per-project IDs: its tale.json has no `id`. */
function legacyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tale-project-context-'));
  writeFileSync(
    join(dir, 'tale.json'),
    `${JSON.stringify({ version: 1, cliVersion: '0.5.94', createdAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`,
  );
  return dir;
}

/** A project whose tale.json carries `id`. */
function projectWithId(id: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tale-project-context-'));
  writeFileSync(
    join(dir, 'tale.json'),
    `${JSON.stringify({ version: 1, id, cliVersion: '0.5.94', createdAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`,
  );
  return dir;
}

describe('resolveOrAssignProjectContext — a project without an ID', () => {
  test('a dry run uses a generated ID and leaves tale.json as it is', async () => {
    const dir = legacyProject();
    try {
      const before = readFileSync(join(dir, 'tale.json'), 'utf-8');
      await resolveOrAssignProjectContext(dir, { dryRun: true });
      expect(isValidProjectId(getProjectId())).toBe(true);
      expect(readFileSync(join(dir, 'tale.json'), 'utf-8')).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a real run saves the ID it assigns', async () => {
    const dir = legacyProject();
    try {
      await resolveOrAssignProjectContext(dir);
      const saved = JSON.parse(readFileSync(join(dir, 'tale.json'), 'utf-8'));
      expect(saved.id).toBe(getProjectId());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.each([
  ['resolveProjectContext', resolveProjectContext],
  ['resolveOrAssignProjectContext', resolveOrAssignProjectContext],
])('%s — a project with an ID', (_name, resolve) => {
  test('keeps a digit-led ID, as `tale init` names a folder like 2024-site', async () => {
    const dir = projectWithId('2024-site-abc123');
    try {
      await resolve(dir);
      expect(getProjectId()).toBe('2024-site-abc123');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses an invalid ID with the rule and the fix', async () => {
    const dir = projectWithId('2024_site');
    try {
      await expect(resolve(dir)).rejects.toThrow(
        invalidProjectIdMessage('2024_site'),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
