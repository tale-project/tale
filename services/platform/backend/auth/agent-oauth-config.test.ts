// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  agentOAuthOptionsFromEnv,
  agentSignInOn,
  DEFAULT_DCR_WEB_REDIRECT_HOSTS,
  invalidHostEntries,
} from './agent-oauth-config.ts';

describe('how a deployment lets coding agents sign in', () => {
  it('opens neither way in by default, so nothing is advertised before the sign-in is complete', () => {
    expect(agentOAuthOptionsFromEnv({})).toEqual({
      metadataDocuments: false,
      metadataHosts: [],
      dynamicRegistration: false,
      webRedirectHosts: [...DEFAULT_DCR_WEB_REDIRECT_HOSTS],
    });
    expect(DEFAULT_DCR_WEB_REDIRECT_HOSTS).toEqual([
      'claude.ai',
      'claude.com',
      'chatgpt.com',
      'vscode.dev',
      'insiders.vscode.dev',
    ]);
  });

  it('turns either way on only for the word true', () => {
    expect(
      agentOAuthOptionsFromEnv({
        TALE_MCP_CLIENT_METADATA_DOCUMENTS: ' TRUE ',
        TALE_MCP_DYNAMIC_CLIENT_REGISTRATION: 'true',
      }),
    ).toMatchObject({ metadataDocuments: true, dynamicRegistration: true });
    expect(
      agentOAuthOptionsFromEnv({
        TALE_MCP_CLIENT_METADATA_DOCUMENTS: 'false',
        TALE_MCP_DYNAMIC_CLIENT_REGISTRATION: '',
      }),
    ).toMatchObject({ metadataDocuments: false, dynamicRegistration: false });
  });

  it('gives agents a way in when either way is on, and none when both are off', () => {
    const off = agentOAuthOptionsFromEnv({});
    expect(agentSignInOn(off)).toBe(false);
    expect(agentSignInOn({ ...off, metadataDocuments: true })).toBe(true);
    expect(agentSignInOn({ ...off, dynamicRegistration: true })).toBe(true);
    expect(
      agentSignInOn({
        ...off,
        metadataDocuments: true,
        dynamicRegistration: true,
      }),
    ).toBe(true);
  });

  it('reads host lists comma- or space-separated, lower-cased, once each', () => {
    expect(
      agentOAuthOptionsFromEnv({
        TALE_MCP_CLIENT_METADATA_HOSTS:
          'Claude.AI, agents.example.com claude.ai',
        TALE_MCP_DCR_WEB_REDIRECT_HOSTS: 'vscode.dev',
      }),
    ).toMatchObject({
      metadataHosts: ['claude.ai', 'agents.example.com'],
      webRedirectHosts: ['vscode.dev'],
    });
    // Set but empty: no web redirect host at all — every agent signs in
    // through a local or app redirect.
    expect(
      agentOAuthOptionsFromEnv({ TALE_MCP_DCR_WEB_REDIRECT_HOSTS: '' })
        .webRedirectHosts,
    ).toEqual([]);
  });

  it('names every entry of a host list that is not a host name', () => {
    expect(invalidHostEntries(undefined)).toEqual([]);
    expect(invalidHostEntries('claude.ai, vscode.dev')).toEqual([]);
    expect(
      invalidHostEntries(
        'https://claude.ai claude.ai:443 claude.ai/cb under_score.example -lead.example',
      ),
    ).toEqual([
      'https://claude.ai',
      'claude.ai:443',
      'claude.ai/cb',
      'under_score.example',
      '-lead.example',
    ]);
  });
});
