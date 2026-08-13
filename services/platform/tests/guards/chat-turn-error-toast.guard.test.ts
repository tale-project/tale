// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Chat turn failures must never toast raw provider payloads. The backend
 * reason string is for logs and the structured message envelope — user-facing
 * copy flows through `turnErrorToastDescription` (or the wrappers that call
 * it). This guard catches regressions like `description: outcome.reason`.
 */

const PLATFORM_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const CHAT_APP_ROOT = path.join(PLATFORM_ROOT, 'app/features/chat');

/** Files that implement the sanctioned helpers — allowed to mention `.reason`. */
const SANCTIONED = new Set([
  'utils/turn-error-toast.ts',
  'utils/turn-error-toast.test.ts',
  'utils/sanitize-chat-error.ts',
  'utils/classify-refusal.ts',
  'data/branch-actions.ts',
]);

const FORBIDDEN = [
  {
    name: 'outcome.reason in toast description',
    pattern: /description:\s*outcome\.reason\b/,
  },
  {
    name: 'failed.reason in toast description',
    pattern: /description:\s*failed\.reason\b/,
  },
  {
    name: 'error.message in toast description',
    pattern: /description:\s*error instanceof Error\s*\?\s*error\.message/,
  },
  {
    name: 'raw provider sentence in toast title',
    pattern: /title:\s*[^t][^,]*model provider answered/i,
  },
];

function chatSourceFiles(dir: string, relative = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...chatSourceFiles(full, rel));
      continue;
    }
    if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.includes('.test.')
    ) {
      out.push(rel);
    }
  }
  return out;
}

describe('chat turn error toast guard', () => {
  it('does not toast raw turn refusal reasons in feature UI code', () => {
    const violations: string[] = [];
    for (const rel of chatSourceFiles(CHAT_APP_ROOT)) {
      if (SANCTIONED.has(rel)) continue;
      const src = readFileSync(path.join(CHAT_APP_ROOT, rel), 'utf8');
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(src)) {
          violations.push(`${rel}: ${rule.name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
