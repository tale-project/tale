// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The repo-root `.env.example` is the platform's environment template, copied
 * to the root `.env` — which Bun loads into every process started from the
 * repo root, `bun run docs:videos` included. The docs-video pipeline takes its
 * ElevenLabs key from the gitignored root `.env.dev` through `loadDevEnv()`,
 * which never overrides a variable that is already set: the empty
 * `ELEVENLABS_API_KEY=` the template once carried hid the real key, and the
 * doctor reported it missing. The marketing site's `WEB_*` keys have their own
 * template, `services/web/.env.example`. This guard keeps both families out of
 * the root template, commented-out assignments included (the template's way
 * of offering an optional variable); naming a key in prose stays allowed.
 * `services/platform/turbo.json` makes the template an input of this
 * workspace's `test` task, so an edit to it alone reruns the guard instead of
 * replaying a cached pass.
 */

const ROOT_ENV_EXAMPLE = fileURLToPath(
  new URL('../../../../.env.example', import.meta.url),
);

/** Key families another env file owns, and that file. */
const FOREIGN_KEY_FAMILIES = [
  {
    prefix: 'ELEVENLABS_',
    home: 'the gitignored repo-root .env.dev (services/platform/tests/docs-videos/README.md)',
  },
  { prefix: 'WEB_', home: 'services/web/.env.example' },
] as const;

/** `KEY=…`, `export KEY=…`, and either one behind a `#`. */
const ASSIGNMENT_RE = /^\s*(?:#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function declaredKeys(source: string): { key: string; line: number }[] {
  return source.split(/\r?\n/).flatMap((text, index) => {
    const key = ASSIGNMENT_RE.exec(text)?.[1];
    return key ? [{ key, line: index + 1 }] : [];
  });
}

function foreignDeclarations(
  source: string,
): { line: number; key: string; belongsIn: string }[] {
  return declaredKeys(source).flatMap(({ key, line }) => {
    const family = FOREIGN_KEY_FAMILIES.find(({ prefix }) =>
      key.startsWith(prefix),
    );
    return family ? [{ line, key, belongsIn: family.home }] : [];
  });
}

describe('root .env.example', () => {
  it('flags docs-video and web-only assignments, active or commented out, never prose', () => {
    const template = [
      'HOST=localhost',
      'ELEVENLABS_API_KEY=',
      'export WEB_FORMS_REQUIRED=true',
      '#   WEB_DISCORD_WEBHOOK_URL=',
      '# ELEVENLABS_API_KEY goes in the repo-root .env.dev, never here.',
      'WEBHOOK_SECRET=',
    ].join('\n');
    expect(
      foreignDeclarations(template).map(({ line, key }) => [line, key]),
    ).toEqual([
      [2, 'ELEVENLABS_API_KEY'],
      [3, 'WEB_FORMS_REQUIRED'],
      [4, 'WEB_DISCORD_WEBHOOK_URL'],
    ]);
  });

  it('declares no docs-video or web-only key', () => {
    const template = readFileSync(ROOT_ENV_EXAMPLE, 'utf8');
    // Sanity: the scan reads the real template's assignments.
    expect(declaredKeys(template).map(({ key }) => key)).toContain('SITE_URL');
    expect(
      foreignDeclarations(template),
      'root .env.example declares keys another env file owns',
    ).toEqual([]);
  });
});
