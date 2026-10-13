// @vitest-environment node

/**
 * Who an app is, read once for the consent page and the connection's record:
 * what the sign-in server keeps of it, what the page may show of it, and
 * whether anyone vouched for it.
 */

import { describe, expect, it } from 'vitest';

import { agentClientIdentity, readAgentClientRow } from './client-identity.ts';
import { recordingSql } from './test-helpers.ts';

const DOCUMENT = 'https://claude.ai/oauth/claude-code-client-metadata';

describe('reading an app', () => {
  it('asks the sign-in server for its name and how it identifies itself, by its id', async () => {
    const { sql, statements } = recordingSql(() => [
      { name: 'Claude Code', discovery: 'cimd' },
    ]);
    await expect(readAgentClientRow(sql, DOCUMENT)).resolves.toEqual({
      name: 'Claude Code',
      discovery: 'cimd',
    });
    expect(statements[0]?.text).toBe(
      'SELECT "name", "clientDiscoveryId" AS "discovery" FROM "oauthClient" WHERE "clientId" = ? LIMIT 1',
    );
    expect(statements[0]?.values).toEqual([DOCUMENT]);
  });

  it('knows no app the sign-in server has no row for', async () => {
    const { sql } = recordingSql(() => []);
    await expect(readAgentClientRow(sql, 'nobody')).resolves.toBeNull();
  });
});

describe('who an app is [AGCONN-R21]', () => {
  it('is verified, and named by the host it was fetched from, when it identifies itself by a metadata document', () => {
    expect(
      agentClientIdentity(DOCUMENT, { name: 'Claude Code', discovery: 'cimd' }),
    ).toEqual({
      name: 'Claude Code',
      provenance: 'metadata_document',
      host: 'claude.ai',
    });
  });

  it('is unverified, with no host, when it registered itself — a document-looking id included', () => {
    expect(
      agentClientIdentity('abc123', { name: 'Cursor', discovery: null }),
    ).toEqual({ name: 'Cursor', provenance: 'registered', host: null });
    expect(
      agentClientIdentity(DOCUMENT, { name: 'Imposter', discovery: null }),
    ).toEqual({ name: 'Imposter', provenance: 'registered', host: null });
  });

  it('shows a name made safe: controls and direction marks gone, no more than 80 characters', () => {
    const named = agentClientIdentity('abc123', {
      name: `  Evil‮\u0000 App ${'x'.repeat(200)}`,
      discovery: null,
    });
    expect(named.name).not.toMatch(/[‮\u0000]/);
    expect(Array.from(named.name).length).toBeLessThanOrEqual(80);
    expect(named.name.startsWith('Evil')).toBe(true);
  });

  it('falls back to its host, then to "App", when it gave no name', () => {
    expect(
      agentClientIdentity(DOCUMENT, { name: ' ', discovery: 'cimd' }).name,
    ).toBe('claude.ai');
    expect(
      agentClientIdentity('abc123', { name: null, discovery: null }).name,
    ).toBe('App');
    expect(agentClientIdentity('abc123', null)).toEqual({
      name: 'App',
      provenance: 'registered',
      host: null,
    });
  });
});
