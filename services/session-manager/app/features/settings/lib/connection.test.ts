import { describe, expect, it } from 'vitest';

import {
  claudeCodeCommand,
  claudeDesktopConfig,
  mcpEndpoint,
  mcpJsonConfig,
} from './connection';

const URL = 'http://127.0.0.1:8000/mcp';

describe('mcpEndpoint', () => {
  it('puts the MCP path on the origin the page is served from', () => {
    expect(mcpEndpoint('http://127.0.0.1:8000')).toBe(URL);
    expect(mcpEndpoint('http://localhost:3004')).toBe(
      'http://localhost:3004/mcp',
    );
  });

  it('does not double a slash at the end of the origin', () => {
    expect(mcpEndpoint('http://127.0.0.1:8000/')).toBe(URL);
  });
});

describe('claudeCodeCommand', () => {
  it('adds the server over HTTP under the name session-manager', () => {
    expect(claudeCodeCommand(URL)).toBe(
      'claude mcp add --transport http session-manager http://127.0.0.1:8000/mcp',
    );
  });
});

describe('mcpJsonConfig', () => {
  it('is the mcp.json entry that points the assistant at the address', () => {
    expect(JSON.parse(mcpJsonConfig(URL))).toEqual({
      mcpServers: { 'session-manager': { url: URL } },
    });
  });

  it('is indented, so it reads as the file the person pastes', () => {
    expect(mcpJsonConfig(URL)).toContain('\n  "mcpServers": {\n');
  });
});

describe('claudeDesktopConfig', () => {
  it('runs mcp-remote against the address, allowing plain http', () => {
    expect(JSON.parse(claudeDesktopConfig(URL))).toEqual({
      mcpServers: {
        'session-manager': {
          command: 'npx',
          args: ['-y', 'mcp-remote', URL, '--allow-http'],
        },
      },
    });
  });
});
