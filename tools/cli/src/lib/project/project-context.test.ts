import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isValidProjectId } from './generate-project-id';
import { getProjectId, resolveOrAssignProjectContext } from './project-context';

/** A project from before per-project IDs: its tale.json has no `id`. */
function legacyProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tale-project-context-'));
  writeFileSync(
    join(dir, 'tale.json'),
    `${JSON.stringify({ version: 1, cliVersion: '0.5.94', createdAt: '2026-01-01T00:00:00.000Z' }, null, 2)}\n`,
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
