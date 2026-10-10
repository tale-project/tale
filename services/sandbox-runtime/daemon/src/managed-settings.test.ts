import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Claude Code policy the runtime image installs at
// /etc/claude-code/managed-settings.json, the highest-precedence settings
// source on Linux: nothing a cloned repository or a user config sets can
// override it.
const settings: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dir, '../../managed-settings.json'), 'utf8'),
);

describe('Claude Code managed settings', () => {
  // Claude Code deletes transcripts older than this many days on start. The
  // store lives on the organization's /agent volume, so the period bounds
  // how much conversation history a session's disk holds. Thirty days is the
  // CLI's own default; a task resumed after its transcript is gone restarts
  // fresh on its preserved files.
  test('prunes transcripts after 60 days, twice the CLI default', () => {
    expect(settings).toMatchObject({ cleanupPeriodDays: 60 });
  });
});
