import { describe, expect, test } from 'bun:test';

import {
  assertCandidate,
  assertSharedServer,
  fullSha,
  platformNode,
} from './browser/prepare-sources.mjs';

describe('browser comparison source boundary', () => {
  test('refuses names, abbreviated SHAs, shell text and uppercase', () => {
    for (const source of [
      'main',
      'a'.repeat(7),
      'A'.repeat(40),
      '--upload-pack=x',
      'a'.repeat(40) + '\n',
      undefined,
    ]) {
      expect(() => fullSha(source)).toThrow();
    }
    expect(fullSha('a'.repeat(40))).toBe('a'.repeat(40));
  });

  test('a checked-out mismatch or dirty source is refused', () => {
    expect(() => assertCandidate('a'.repeat(40), 'b'.repeat(40), '')).toThrow(
      'differs',
    );
    expect(() =>
      assertCandidate('a'.repeat(40), 'a'.repeat(40), ' M code.ts'),
    ).toThrow('tracked changes');
    expect(() =>
      assertCandidate('a'.repeat(40), 'a'.repeat(40), ''),
    ).not.toThrow();
  });

  test('a shared API refuses changed runtime or dependency inputs', () => {
    for (const path of [
      'bun.lock',
      'package.json',
      'packages/ui/package.json',
      'patches/library.patch',
      'services/platform/backend/app.ts',
      'services/platform/server.ts',
      'services/platform/telemetry.ts',
      'services/platform/status-probe.ts',
      'services/platform/sla-targets.ts',
      'services/proxy/Caddyfile',
      'services/platform/lib/schema.ts',
      'services/platform/messages/en.yml',
      'packages/ui/src/i18n/accept-language.ts',
      'packages/ui/src/i18n/locales.ts',
      'packages/ui/src/lib/format.ts',
      'packages/shared/src/a.ts',
      'configs/platform/custom/a.yml',
      'services/db/Dockerfile',
      'tsconfig.base.json',
      'services/platform/tsconfig.json',
    ]) {
      expect(() => assertSharedServer([path])).toThrow(
        'Shared API requires identical',
      );
    }
  });

  test('permits frontend and diagnostic changes without broadening the server', () => {
    expect(() =>
      assertSharedServer([
        'services/platform/app/features/tasks/components/task-card.tsx',
        'scripts/performance/browser/run-linux.ts',
        '.github/workflows/browser-performance.yml',
        'services/platform/tests/manual/reference/automation.md',
      ]),
    ).not.toThrow();
  });

  test('reads only an exact Node binary-stage version', () => {
    expect(platformNode('FROM node:22.22.0-bookworm-slim AS node-bin')).toBe(
      '22.22.0',
    );
    for (const input of [
      'FROM node:latest AS node-bin',
      'FROM node:22.22.0 AS build',
      '',
    ]) {
      expect(() => platformNode(input)).toThrow();
    }
  });
});
