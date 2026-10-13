import { describe, expect, it } from 'vitest';

import { MCP_SERVER_NAME, SETUP_CLIENTS, setupSteps } from './setup-steps';

const ADDRESS = 'https://tale.example.com/api/v1/mcp';

/** What a person copies into a terminal: exactly the command, nothing else. */
describe('setupSteps', () => {
  it('adds Tale to Claude Code, then signs in', () => {
    expect(setupSteps('claude-code', ADDRESS)).toEqual([
      {
        text: 'claudeCodeAdd',
        code: 'claude mcp add --transport http tale https://tale.example.com/api/v1/mcp',
      },
      { text: 'claudeCodeSignIn', code: 'claude mcp login tale' },
    ]);
  });

  it('adds Tale to Codex, then signs in', () => {
    expect(setupSteps('codex', ADDRESS)).toEqual([
      {
        text: 'codexAdd',
        code: 'codex mcp add tale --url https://tale.example.com/api/v1/mcp',
      },
      { text: 'codexSignIn', code: 'codex mcp login tale' },
    ]);
  });

  it('gives any other client the address, and the way to sign in with words', () => {
    expect(setupSteps('other', ADDRESS)).toEqual([
      { text: 'otherAddress', code: ADDRESS },
      { text: 'otherSignIn' },
    ]);
  });

  it('names the server the same in every command', () => {
    for (const client of ['claude-code', 'codex'] as const) {
      for (const step of setupSteps(client, ADDRESS) ?? []) {
        expect(step.code).toContain(` ${MCP_SERVER_NAME}`);
      }
    }
  });

  it.each([
    ['a local address with a port', 'http://localhost:3000/api/v1/mcp'],
    ['an address under a base path', 'https://example.com/app/api/v1/mcp'],
    ['an address with an IP and a port', 'http://127.0.0.1:3120/api/v1/mcp'],
  ])('accepts %s', (_case, address) => {
    for (const client of SETUP_CLIENTS) {
      expect(setupSteps(client, address)).not.toBeNull();
    }
  });

  it.each([
    ['a quote', "https://example.com/'; rm -rf ~ #"],
    ['a space', 'https://example.com/api v1/mcp'],
    ['a semicolon', 'https://example.com/api;touch x/mcp'],
    ['a dollar sign', 'https://example.com/$HOME/mcp'],
    ['a backtick', 'https://example.com/`id`/mcp'],
    ['a pipe', 'https://example.com/api|cat/mcp'],
    ['a newline', 'https://example.com/api\nmcp'],
    ['an ampersand', 'https://example.com/api?a=1&b=2'],
    [
      'credentials in the address',
      'https://user:secret@example.com/api/v1/mcp',
    ],
    ['another scheme', 'ftp://example.com/api/v1/mcp'],
    ['nothing', ''],
  ])('refuses an address with %s, for every client', (_case, address) => {
    for (const client of SETUP_CLIENTS) {
      expect(setupSteps(client, address)).toBeNull();
    }
  });

  it('carries no key: the only input is the address', () => {
    // A command is built from the address alone; whatever a caller might hold
    // beside it (a key, a token) has no way in.
    expect(setupSteps.length).toBe(2);
    const everything = SETUP_CLIENTS.flatMap(
      (client) => setupSteps(client, ADDRESS) ?? [],
    )
      .map((step) => step.code ?? '')
      .join('\n');
    expect(everything).not.toMatch(
      /tale_[A-Za-z0-9]{8,}|bearer|authorization/i,
    );
  });
});
