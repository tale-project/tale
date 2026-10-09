import { describe, expect, it } from 'vitest';

import {
  invalidAllowedOrigins,
  judgeMcpOrigin,
  loggableOrigin,
  mcpOriginEnforced,
  normalizeOrigin,
} from './origin.ts';

const SITE = {
  SITE_URL: 'https://tale.example',
  ADDITIONAL_SITE_URLS: 'https://tale.partner.example',
};

describe('normalizeOrigin', () => {
  it('spells an origin one way', () => {
    expect(normalizeOrigin('https://Tale.Example:443/')).toBe(
      'https://tale.example',
    );
    expect(normalizeOrigin('http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
    expect(normalizeOrigin('vscode-file://VSCode-App')).toBe(
      'vscode-file://vscode-app',
    );
  });

  it('is not fooled by a path, a query, credentials or free text', () => {
    for (const value of [
      'https://tale.example/admin',
      'https://tale.example?x=1',
      'https://user@tale.example',
      'null',
      'tale.example',
      '',
    ]) {
      expect(normalizeOrigin(value), value).toBeNull();
    }
  });
});

describe('judgeMcpOrigin', () => {
  it('never judges a request without an Origin — a CLI or a server', () => {
    expect(judgeMcpOrigin(undefined, SITE)).toBe('absent');
  });

  it("accepts the deployment's own origins and the ones the operator lists", () => {
    expect(judgeMcpOrigin('https://tale.example', SITE)).toBe('allowed');
    expect(judgeMcpOrigin('https://tale.partner.example', SITE)).toBe(
      'allowed',
    );
    const listed = {
      ...SITE,
      TALE_MCP_ALLOWED_ORIGINS: 'vscode-file://vscode-app https://ide.example',
    };
    expect(judgeMcpOrigin('vscode-file://vscode-app', listed)).toBe('allowed');
    expect(judgeMcpOrigin('https://IDE.example', listed)).toBe('allowed');
  });

  it('calls any other origin, or a value that is not one, a mismatch', () => {
    expect(judgeMcpOrigin('https://evil.example', SITE)).toBe('mismatch');
    expect(judgeMcpOrigin('null', SITE)).toBe('mismatch');
    expect(judgeMcpOrigin('https://tale.example.evil.example', SITE)).toBe(
      'mismatch',
    );
  });
});

describe('the operator switches', () => {
  it('enforces only when told to', () => {
    expect(mcpOriginEnforced({})).toBe(false);
    expect(mcpOriginEnforced({ TALE_MCP_ORIGIN_ENFORCE: 'false' })).toBe(false);
    expect(mcpOriginEnforced({ TALE_MCP_ORIGIN_ENFORCE: 'true' })).toBe(true);
  });

  it('names the entries of the list that are not origins', () => {
    expect(
      invalidAllowedOrigins('https://a.example, https://b.example/x junk'),
    ).toEqual(['https://b.example/x', 'junk']);
    expect(invalidAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('loggableOrigin', () => {
  it('prints an origin, never free text a caller chose', () => {
    expect(loggableOrigin('https://Evil.example')).toBe('https://evil.example');
    expect(loggableOrigin('x\n[mcp] forged line')).toBe('(not an origin)');
  });
});
